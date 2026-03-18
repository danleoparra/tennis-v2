import "./globals.css";

export const metadata = {
  title: "Tennis Visualizer 2.0",
  description: "Tactical tennis court visualizer with angles, coverage, trajectories and score.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
