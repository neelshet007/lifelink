import './globals.css';

export const metadata = {
  title: 'LifeLink | Smart Blood Matching',
  description: 'Real-time platform connecting blood donors, patients, hospitals, and blood banks.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-brand-dark text-white selection:bg-lifered-500 selection:text-white flex flex-col">
        {children}
      </body>
    </html>
  );
}
