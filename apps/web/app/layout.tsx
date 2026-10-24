import type { Metadata } from "next";
import { AppProviders } from "@/app/providers";
import "./globals.css";
import "@/shared/ui/operations.css";
export const metadata: Metadata = {
  title: "Artmate WMS — склад под контролем",
  description: "Адресное хранение, FIFO и работа склада в одной системе.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
