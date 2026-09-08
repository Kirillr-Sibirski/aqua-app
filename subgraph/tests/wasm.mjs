/**
 * The host, played by Node.
 *
 * A subgraph mapping is a WebAssembly module with a handful of imports: a store, a logger, a data
 * source context, and a few conversions. graph-node supplies them from Rust with Postgres behind
 * it. This file supplies the same imports from JavaScript with a `Map` behind it, which is enough
 * to run the real mapping over real event payloads and read back the entity graph a GraphQL query
 * would be served from.
 *
 * What is real here: the compiled mapping (`tests/harness.ts` is a door into `src/*.ts`, compiled
 * with the exact `asc` arguments `graph build` uses), the event decoding, the handler logic, the
 * entity shapes, and the arithmetic — `bigInt.plus`/`minus` are computed with JavaScript BigInt and
 * handed back as graph-node hands them back, in signed little-endian bytes.
 *
 * What is not: durability and isolation. graph-node's `store.set` copies the entity into Postgres;
 * here the store keeps the pointer, so a handler that mutated an entity without saving it would be
 * seen here and dropped there. Every handler in `src/` saves what it mutates, and
 * `tests/handlers.test.mjs` asserts the entities after the whole event sequence, which is the state
 * a query returns either way. Ordering, reverts and block boundaries are graph-node's business and
 * are not modelled.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = join(root, 'tests/build/harness.wasm');

/** graph-ts `TypeId`, from `@graphprotocol/graph-ts/global/global.ts`. */
const TYPE_ID = { String: 0, ArrayBuffer: 1, Uint8Array: 6 };

/** graph-ts `ValueKind`, from `@graphprotocol/graph-ts/common/value.ts`. */
const VALUE_KIND = ['String', 'Int', 'BigDecimal', 'Bool', 'Array', 'Null', 'Bytes', 'BigInt', 'Int8', 'Timestamp'];

/**
 * Compile the harness the way `graph build` compiles a mapping.
 *
 * The argument list is copied from `@graphprotocol/graph-cli/dist/compiler/asc.js::compile`. If it
 * ever drifts from this one, the thing under test stops being the thing that ships.
 */
export function compile() {
  const sources = ['tests/harness.ts', 'src/decode.ts', 'src/bytes.ts', 'src/aqua.ts', 'src/router.ts'];
  const newest = Math.max(...sources.map((file) => statSync(join(root, file)).mtimeMs));
  let built = 0;
  try {
    built = statSync(wasmPath).mtimeMs;
  } catch {
    built = 0;
  }
  if (built > newest) return;

  const asc = join(root, 'node_modules/.bin/asc');
  if (!existsSync(asc)) {
    throw new Error(
      `${asc} is missing. It comes with @graphprotocol/graph-cli, which compiles the mappings with ` +
        'it; run `npm install` in subgraph/ first.',
    );
  }

  mkdirSync(join(root, 'tests/build'), { recursive: true });
  execFileSync(
    asc,
    [
      '--explicitStart',
      '--exportRuntime',
      '--runtime',
      'stub',
      'tests/harness.ts',
      'node_modules/@graphprotocol/graph-ts/global/global.ts',
      '--baseDir',
      '.',
      '--lib',
      'node_modules',
      '--outFile',
      'tests/build/harness.wasm',
      '--optimize',
      '--debug',
    ],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

/**
 * Load the mapping and stand up a host for it.
 *
 * Returns the module's exports plus the readers a test needs: the store it wrote into, and the
 * helpers that turn a wasm pointer back into a JavaScript value.
 */
export async function load({ router } = {}) {
  compile();

  /** entity name -> id -> pointer, exactly the addressing graph-node's store uses. */
  const store = new Map();
  const logs = [];
  let wasm;
  let context = 0;

  const memory = () => new DataView(wasm.memory.buffer);
  const bytesAt = (pointer, length) => new Uint8Array(wasm.memory.buffer, pointer, length);

  /** `Uint8Array` and every subclass (`Bytes`, `BigInt`) share this header: buffer, dataStart, length. */
  function viewOf(pointer) {
    const view = memory();
    return bytesAt(view.getUint32(pointer + 4, true), view.getUint32(pointer + 8, true));
  }

  /** An AssemblyScript string: UTF-16 at the pointer, byte length in the object header at -4. */
  function stringAt(pointer) {
    const length = memory().getUint32(pointer - 4, true) / 2;
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(memory().getUint16(pointer + i * 2, true));
    return out;
  }

  function allocString(text) {
    const pointer = wasm.__new(text.length * 2, wasm.id_of_type(TYPE_ID.String));
    const view = memory();
    for (let i = 0; i < text.length; i++) view.setUint16(pointer + i * 2, text.charCodeAt(i), true);
    return pointer;
  }

  /** A `Uint8Array`-shaped object, allocated the way graph-node allocates one to return it. */
  function allocBytes(bytes, typeId = TYPE_ID.Uint8Array) {
    const buffer = wasm.__new(bytes.length, wasm.id_of_type(TYPE_ID.ArrayBuffer));
    new Uint8Array(wasm.memory.buffer, buffer, bytes.length).set(bytes);
    const object = wasm.__new(12, wasm.id_of_type(typeId));
    const view = memory();
    view.setUint32(object, buffer, true);
    view.setUint32(object + 4, buffer, true);
    view.setUint32(object + 8, bytes.length, true);
    return object;
  }

  /** graph-node's BigInt is a signed little-endian magnitude. */
  function bigIntAt(pointer) {
    const bytes = viewOf(pointer);
    if (bytes.length === 0) return 0n;
    let value = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    if (bytes[bytes.length - 1] & 0x80) value -= 1n << BigInt(8 * bytes.length);
    return value;
  }

  function allocBigInt(value) {
    const bytes = [];
    let remaining = value;
    if (remaining === 0n) bytes.push(0);
    while (remaining !== 0n && remaining !== -1n) {
      bytes.push(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    const negative = value < 0n;
    const top = bytes.length === 0 ? 0 : bytes[bytes.length - 1];
    if (!negative && top & 0x80) bytes.push(0);
    if (negative && !(top & 0x80)) bytes.push(0xff);
    return allocBytes(Uint8Array.from(bytes));
  }

  const imports = {
    env: {
      abort(message, file, line, column) {
        throw new Error(
          `mapping aborted at ${line}:${column}${message ? `: ${stringAt(message)}` : ''}`,
        );
      },
    },
    index: {
      'store.get'(entity, id) {
        return store.get(stringAt(entity))?.get(stringAt(id)) ?? 0;
      },
      'store.set'(entity, id, data) {
        const name = stringAt(entity);
        if (!store.has(name)) store.set(name, new Map());
        store.get(name).set(stringAt(id), data);
      },
      'store.remove'(entity, id) {
        store.get(stringAt(entity))?.delete(stringAt(id));
      },
      'log.log'(level, message) {
        logs.push({ level, message: stringAt(message) });
      },
    },
    datasource: {
      'dataSource.context'() {
        return context;
      },
    },
    conversion: {
      'typeConversion.bytesToHex'(pointer) {
        return allocString(`0x${Buffer.from(viewOf(pointer)).toString('hex')}`);
      },
      'typeConversion.stringToH160'(pointer) {
        return wasm.h160(pointer);
      },
      'typeConversion.bigIntToString'(pointer) {
        return allocString(bigIntAt(pointer).toString());
      },
    },
    numbers: {
      'bigInt.plus': (a, b) => allocBigInt(bigIntAt(a) + bigIntAt(b)),
      'bigInt.minus': (a, b) => allocBigInt(bigIntAt(a) - bigIntAt(b)),
      'bigDecimal.toString'() {
        throw new Error('bigDecimal is not reachable from these mappings');
      },
    },
  };

  const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), imports);
  wasm = instance.exports;
  wasm._start(); // --explicitStart: graph-node calls this before the first handler too.

  let argCount = 0;

  /** Push a byte buffer into the module and return its argument index. */
  function arg(bytes) {
    const index = argCount++;
    const pointer = wasm.pushArg(bytes.length);
    viewOf(pointer).set(bytes);
    return index;
  }

  function resetArgs() {
    wasm.clearArgs();
    argCount = 0;
  }

  // The data source context, built inside the module and handed back to it on every
  // `dataSource.context()`. `src/aqua.ts` reads `router` from it as the app filter, because Aqua's
  // events carry no indexed parameters and the filter cannot live in the manifest.
  context = router === undefined ? wasm.makeEmptyContext() : wasm.makeContext(arg(ascii(router)));
  resetArgs();

  /** One `Value` out of an entity's `TypedMap`, as a plain JavaScript value. */
  function valueAt(pointer) {
    const view = memory();
    const kind = view.getInt32(pointer, true);
    const data = view.getUint32(pointer + 8, true);
    switch (VALUE_KIND[kind]) {
      case 'String':
        return stringAt(data);
      case 'Int':
        return view.getInt32(pointer + 8, true);
      case 'Bool':
        return data !== 0;
      case 'Null':
        return null;
      case 'Bytes':
        return `0x${Buffer.from(viewOf(data)).toString('hex')}`;
      case 'BigInt':
        return bigIntAt(data);
      case 'Int8':
      case 'Timestamp':
        return view.getBigInt64(pointer + 8, true);
      case 'Array': {
        // Array<Value>: an ArrayBufferView plus a length at +12.
        const dataStart = view.getUint32(data + 4, true);
        const length = view.getInt32(data + 12, true);
        const out = [];
        for (let i = 0; i < length; i++) out.push(valueAt(memory().getUint32(dataStart + i * 4, true)));
        return out;
      }
      default:
        throw new Error(`unhandled ValueKind ${kind}`);
    }
  }

  /** An entity, as a plain object: the fields a GraphQL response is served from. */
  function entityAt(pointer) {
    const view = memory();
    const entries = view.getUint32(pointer, true);
    const dataStart = view.getUint32(entries + 4, true);
    const length = view.getInt32(entries + 12, true);
    const out = {};
    for (let i = 0; i < length; i++) {
      const entry = memory().getUint32(dataStart + i * 4, true);
      const key = stringAt(memory().getUint32(entry, true));
      out[key] = valueAt(memory().getUint32(entry + 4, true));
    }
    return out;
  }

  return {
    wasm,
    logs,
    arg,
    resetArgs,
    viewOf,
    bigIntAt,
    /** Every entity of a type, by id, as plain objects. */
    entities(name) {
      const rows = store.get(name);
      if (!rows) return new Map();
      return new Map([...rows.entries()].map(([id, pointer]) => [id, entityAt(pointer)]));
    },
    entity(name, id) {
      const pointer = store.get(name)?.get(id);
      return pointer === undefined ? undefined : entityAt(pointer);
    },
  };
}

/** ASCII bytes of a string, for the argument buffers. */
export function ascii(text) {
  return Uint8Array.from(Buffer.from(text, 'ascii'));
}

/** Bytes of a `0x` hex string. */
export function hexBytes(text) {
  return Uint8Array.from(Buffer.from(text.replace(/^0x/, ''), 'hex'));
}

/** A 32-byte big-endian word, the way an amount sits in a log. */
export function word(value) {
  const out = new Uint8Array(32);
  let remaining = BigInt(value);
  for (let i = 31; i >= 0 && remaining > 0n; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

export const hex = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
