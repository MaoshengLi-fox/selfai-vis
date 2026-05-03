import './globals.css';
import 'katex/dist/katex.min.css';

export const metadata = {
  title: 'Paper Viewer | 2512.00403v2',
  description: 'A focused interface for reading the paper 2512.00403v2.pdf'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
