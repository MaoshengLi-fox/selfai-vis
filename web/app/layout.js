import './globals.css';
import 'katex/dist/katex.min.css';

export const metadata = {
  title: 'SelfAI | NeurIPS 2026 Project Page',
  description: 'SelfAI project page reconstructed from NeurIPS 2026 LaTeX source files.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
