import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Vispr · Inference marketplace', description: 'Task-aware model selection and inference auctions.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
