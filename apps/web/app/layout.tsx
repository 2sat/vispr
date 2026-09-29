import type { Metadata } from "next";
export const metadata: Metadata = { title: "Vispr", description: "Inference routing and provider auctions" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body style={{margin:0,fontFamily:"system-ui",background:"#10151c",color:"#eef3fa"}}>{children}</body></html>; }
