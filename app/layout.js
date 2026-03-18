import "./globals.css";

export const metadata = {
  title: "Tennis Court Angle Visualizer",
  description: "Drag players to study real shot windows into the opposite court.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
