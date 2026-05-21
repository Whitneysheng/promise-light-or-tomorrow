import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "promise light or tomorrow",
  description: "Participatory whisper archive and performance cue system.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
