import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import type { ReactNode } from "react";

export const metadata = { title: "@hussmartinez/audio-sdk in Next.js" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <body style={{ height: "100%", margin: 0 }}>{children}</body>
    </html>
  );
}
