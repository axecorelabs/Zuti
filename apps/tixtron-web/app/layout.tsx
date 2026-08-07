import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from '@/lib/theme';
import './globals.css';

// Runs before first paint (blocking, in <head>) so there's no flash of the wrong theme. Default is
// dark unless the visitor has explicitly chosen light before — mirrored in lib/theme.tsx.
const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('tixtron-theme');
    if (stored !== 'light') document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
const vercelUrl = process.env.VERCEL_URL;
const appUrl = (configuredUrl ?? (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3004')).replace(/\/$/, '');

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'Tixtron — Smart Ticketing. Seamless Experiences.',
  description: 'Sell tickets and manage events with smart, reliable, fast tools. Powered by Zuti.',
  // favicon.ico and apple-icon.png are picked up automatically via Next's file-convention
  // (app/favicon.ico, app/apple-icon.png) — listed explicitly here too so browsers that only
  // read <link> tags (not all respect the convention-generated defaults) get precise sizes.
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    url: appUrl,
    title: 'Tixtron — Smart Ticketing. Seamless Experiences.',
    description: 'Sell tickets and manage events with smart, reliable, fast tools. Powered by Zuti.',
    siteName: 'Tixtron',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tixtron — Smart Ticketing. Seamless Experiences.',
    description: 'Sell tickets and manage events with smart, reliable, fast tools. Powered by Zuti.',
  },
};

export const viewport: Viewport = {
  themeColor: '#FF6A00',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1D2023',
                color: '#FAFAFB',
                border: '1px solid #33383C',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '300',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
