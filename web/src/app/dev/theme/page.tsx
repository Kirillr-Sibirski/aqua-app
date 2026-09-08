import type { Metadata } from 'next';
import { ThemePreview } from '@/components/theme/ThemePreview';

export const metadata: Metadata = {
  title: 'Theme',
  description: 'The light palette, the type scale and the Mantine vocabulary, with measured contrast.',
};

/** Not linked from the app. The reference surface for the design system. */
export default function ThemePage() {
  return <ThemePreview />;
}
