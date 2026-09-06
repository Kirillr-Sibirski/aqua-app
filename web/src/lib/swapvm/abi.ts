/**
 * Minimal ABIs for the frontend. Extracted from Foundry artifacts:
 *   swapVmAbi  <- contracts/out/ProbeRouter.sol/ProbeRouter.json (ISwapVM surface + errors)
 *   aquaAbi    <- contracts/out/IAqua.sol/IAqua.json (@1inch/aqua IAqua)
 * Regenerate with the script in the README if the contracts change.
 */

/** ISwapVM (ProbeRouter): hash / quote / swap / AQUA / WETH / simulate + Swapped event + all revert errors. */
export const swapVmAbi = [
  {
    type: 'function',
    name: 'AQUA',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'asView',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'eip712Domain',
    inputs: [],
    outputs: [
      {
        name: 'fields',
        type: 'bytes1'
      },
      {
        name: 'name',
        type: 'string'
      },
      {
        name: 'version',
        type: 'string'
      },
      {
        name: 'chainId',
        type: 'uint256'
      },
      {
        name: 'verifyingContract',
        type: 'address'
      },
      {
        name: 'salt',
        type: 'bytes32'
      },
      {
        name: 'extensions',
        type: 'uint256[]'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'hash',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          {
            name: 'maker',
            type: 'address'
          },
          {
            name: 'traits',
            type: 'uint256'
          },
          {
            name: 'data',
            type: 'bytes'
          }
        ]
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'ORDER_TYPEHASH',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'quote',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          {
            name: 'maker',
            type: 'address'
          },
          {
            name: 'traits',
            type: 'uint256'
          },
          {
            name: 'data',
            type: 'bytes'
          }
        ]
      },
      {
        name: 'amount',
        type: 'uint256'
      },
      {
        name: 'takerTraitsAndData',
        type: 'bytes'
      }
    ],
    outputs: [
      {
        name: 'amountIn',
        type: 'uint256'
      },
      {
        name: 'amountOut',
        type: 'uint256'
      },
      {
        name: 'orderHash',
        type: 'bytes32'
      }
    ],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'simulate',
    inputs: [
      {
        name: 'delegatee',
        type: 'address'
      },
      {
        name: 'data',
        type: 'bytes'
      }
    ],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'swap',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          {
            name: 'maker',
            type: 'address'
          },
          {
            name: 'traits',
            type: 'uint256'
          },
          {
            name: 'data',
            type: 'bytes'
          }
        ]
      },
      {
        name: 'amount',
        type: 'uint256'
      },
      {
        name: 'takerTraitsAndData',
        type: 'bytes'
      }
    ],
    outputs: [
      {
        name: 'amountIn',
        type: 'uint256'
      },
      {
        name: 'amountOut',
        type: 'uint256'
      },
      {
        name: 'orderHash',
        type: 'bytes32'
      }
    ],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'WETH',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      {
        name: 'orderHash',
        type: 'bytes32',
        indexed: false
      },
      {
        name: 'maker',
        type: 'address',
        indexed: false
      },
      {
        name: 'taker',
        type: 'address',
        indexed: false
      },
      {
        name: 'tokenIn',
        type: 'address',
        indexed: false
      },
      {
        name: 'tokenOut',
        type: 'address',
        indexed: false
      },
      {
        name: 'amountIn',
        type: 'uint256',
        indexed: false
      },
      {
        name: 'amountOut',
        type: 'uint256',
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: 'error',
    name: 'AquaBalanceInsufficientAfterTakerPush',
    inputs: [
      {
        name: 'balance',
        type: 'uint256'
      },
      {
        name: 'preBalance',
        type: 'uint256'
      },
      {
        name: 'amount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'BadSignature',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'orderHash',
        type: 'bytes32'
      },
      {
        name: 'signature',
        type: 'bytes'
      }
    ]
  },
  {
    type: 'error',
    name: 'DeadlineReached',
    inputs: [
      {
        name: 'deadline',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'EthDepositRejected',
    inputs: []
  },
  {
    type: 'error',
    name: 'EthTransferFailed',
    inputs: []
  },
  {
    type: 'error',
    name: 'ETHTransferFailed',
    inputs: []
  },
  {
    type: 'error',
    name: 'ExtructionChoppedExceedsLength',
    inputs: [
      {
        name: 'chopped',
        type: 'bytes'
      },
      {
        name: 'requested',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'FeeBpsOutOfRange',
    inputs: [
      {
        name: 'feeBps',
        type: 'uint256'
      },
      {
        name: 'surplusBps',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'ForceApproveFailed',
    inputs: []
  },
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: []
  },
  {
    type: 'error',
    name: 'InvalidShortString',
    inputs: []
  },
  {
    type: 'error',
    name: 'MakerTraitsCustomReceiverIsIncompatibleWithAqua',
    inputs: []
  },
  {
    type: 'error',
    name: 'MakerTraitsUnwrapIsIncompatibleWithAqua',
    inputs: []
  },
  {
    type: 'error',
    name: 'MakerTraitsZeroAmountInNotAllowed',
    inputs: []
  },
  {
    type: 'error',
    name: 'MsgValueInvalidToken',
    inputs: []
  },
  {
    type: 'error',
    name: 'NotEnoughMsgValueAttached',
    inputs: []
  },
  {
    type: 'error',
    name: 'OwnableInvalidOwner',
    inputs: [
      {
        name: 'owner',
        type: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [
      {
        name: 'account',
        type: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'PeggedSwapMathInvalidInput',
    inputs: []
  },
  {
    type: 'error',
    name: 'PeggedSwapMathNoSolution',
    inputs: []
  },
  {
    type: 'error',
    name: 'RunLoopExceedProgramLength',
    inputs: [
      {
        name: 'pc',
        type: 'uint256'
      },
      {
        name: 'programLength',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'SafeCastOverflowedUintDowncast',
    inputs: [
      {
        name: 'bits',
        type: 'uint8'
      },
      {
        name: 'value',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'SafeTransferFailed',
    inputs: []
  },
  {
    type: 'error',
    name: 'SafeTransferFromFailed',
    inputs: []
  },
  {
    type: 'error',
    name: 'Simulated',
    inputs: [
      {
        name: 'delegatee',
        type: 'address'
      },
      {
        name: 'data',
        type: 'bytes'
      },
      {
        name: 'success',
        type: 'bool'
      },
      {
        name: 'result',
        type: 'bytes'
      }
    ]
  },
  {
    type: 'error',
    name: 'StringTooLong',
    inputs: [
      {
        name: 'str',
        type: 'string'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTokenBalanceIsLessThanRequired',
    inputs: [
      {
        name: 'taker',
        type: 'address'
      },
      {
        name: 'token',
        type: 'address'
      },
      {
        name: 'balance',
        type: 'uint256'
      },
      {
        name: 'amount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTokenBalanceIsZero',
    inputs: [
      {
        name: 'taker',
        type: 'address'
      },
      {
        name: 'token',
        type: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTokenBalanceSupplyShareIsLessThanRequired',
    inputs: [
      {
        name: 'taker',
        type: 'address'
      },
      {
        name: 'token',
        type: 'address'
      },
      {
        name: 'balance',
        type: 'uint256'
      },
      {
        name: 'totalSupply',
        type: 'uint256'
      },
      {
        name: 'share',
        type: 'uint64'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsAmountOutMustBeGreaterThanZero',
    inputs: [
      {
        name: 'amountOut',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsDeadlineExpired',
    inputs: []
  },
  {
    type: 'error',
    name: 'TakerTraitsExceedingMaxInputAmount',
    inputs: [
      {
        name: 'amountIn',
        type: 'uint256'
      },
      {
        name: 'amountInMax',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsInsufficientMinOutputAmount',
    inputs: [
      {
        name: 'amountOut',
        type: 'uint256'
      },
      {
        name: 'amountOutMin',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsNonExactThresholdAmountIn',
    inputs: [
      {
        name: 'amountIn',
        type: 'uint256'
      },
      {
        name: 'amountThreshold',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsNonExactThresholdAmountOut',
    inputs: [
      {
        name: 'amountOut',
        type: 'uint256'
      },
      {
        name: 'amountThreshold',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsTakerAmountInExceed',
    inputs: [
      {
        name: 'takerAmount',
        type: 'uint256'
      },
      {
        name: 'computedAmount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsTakerAmountInMismatch',
    inputs: [
      {
        name: 'takerAmount',
        type: 'uint256'
      },
      {
        name: 'computedAmount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsTakerAmountOutExceed',
    inputs: [
      {
        name: 'takerAmount',
        type: 'uint256'
      },
      {
        name: 'computedAmount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TakerTraitsTakerAmountOutMismatch',
    inputs: [
      {
        name: 'takerAmount',
        type: 'uint256'
      },
      {
        name: 'computedAmount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'TxOriginTokenBalanceIsZero',
    inputs: [
      {
        name: 'txOrigin',
        type: 'address'
      },
      {
        name: 'token',
        type: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'UnexpectedLock',
    inputs: []
  },
  {
    type: 'error',
    name: 'UnexpectedMsgValue',
    inputs: []
  },
  {
    type: 'error',
    name: 'UnknownOpcode',
    inputs: [
      {
        name: 'opcode',
        type: 'uint256'
      }
    ]
  }
] as const;

/** @1inch/aqua IAqua: ship / dock / push / pull / rawBalances / safeBalances + events + errors. */
export const aquaAbi = [
  {
    type: 'function',
    name: 'dock',
    inputs: [
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'tokens',
        type: 'address[]'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'pull',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'token',
        type: 'address'
      },
      {
        name: 'amount',
        type: 'uint256'
      },
      {
        name: 'to',
        type: 'address'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'push',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'token',
        type: 'address'
      },
      {
        name: 'amount',
        type: 'uint256'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'rawBalances',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'token',
        type: 'address'
      }
    ],
    outputs: [
      {
        name: 'balance',
        type: 'uint248'
      },
      {
        name: 'tokensCount',
        type: 'uint8'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'safeBalances',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'token0',
        type: 'address'
      },
      {
        name: 'token1',
        type: 'address'
      }
    ],
    outputs: [
      {
        name: 'balance0',
        type: 'uint256'
      },
      {
        name: 'balance1',
        type: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'ship',
    inputs: [
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategy',
        type: 'bytes'
      },
      {
        name: 'tokens',
        type: 'address[]'
      },
      {
        name: 'amounts',
        type: 'uint256[]'
      }
    ],
    outputs: [
      {
        name: 'strategyHash',
        type: 'bytes32'
      }
    ],
    stateMutability: 'nonpayable'
  },
  {
    type: 'event',
    name: 'Docked',
    inputs: [
      {
        name: 'maker',
        type: 'address',
        indexed: false
      },
      {
        name: 'app',
        type: 'address',
        indexed: false
      },
      {
        name: 'strategyHash',
        type: 'bytes32',
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'Pulled',
    inputs: [
      {
        name: 'maker',
        type: 'address',
        indexed: false
      },
      {
        name: 'app',
        type: 'address',
        indexed: false
      },
      {
        name: 'strategyHash',
        type: 'bytes32',
        indexed: false
      },
      {
        name: 'token',
        type: 'address',
        indexed: false
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'Pushed',
    inputs: [
      {
        name: 'maker',
        type: 'address',
        indexed: false
      },
      {
        name: 'app',
        type: 'address',
        indexed: false
      },
      {
        name: 'strategyHash',
        type: 'bytes32',
        indexed: false
      },
      {
        name: 'token',
        type: 'address',
        indexed: false
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'Shipped',
    inputs: [
      {
        name: 'maker',
        type: 'address',
        indexed: false
      },
      {
        name: 'app',
        type: 'address',
        indexed: false
      },
      {
        name: 'strategyHash',
        type: 'bytes32',
        indexed: false
      },
      {
        name: 'strategy',
        type: 'bytes',
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: 'error',
    name: 'DockingShouldCloseAllTokens',
    inputs: [
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      }
    ]
  },
  {
    type: 'error',
    name: 'MaxNumberOfTokensExceeded',
    inputs: [
      {
        name: 'tokensCount',
        type: 'uint256'
      },
      {
        name: 'maxTokensCount',
        type: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'PushToNonActiveStrategyPrevented',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'token',
        type: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'SafeBalancesForTokenNotInActiveStrategy',
    inputs: [
      {
        name: 'maker',
        type: 'address'
      },
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      },
      {
        name: 'token',
        type: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'StrategiesMustBeImmutable',
    inputs: [
      {
        name: 'app',
        type: 'address'
      },
      {
        name: 'strategyHash',
        type: 'bytes32'
      }
    ]
  }
] as const;

/** Standard ERC-20 ABI re-exported from viem (approve / allowance / balanceOf ...). */
export { erc20Abi } from 'viem';
