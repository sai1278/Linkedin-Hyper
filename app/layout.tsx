import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Analytics, GoogleTagManagerNoScript, CustomScripts } from "@/components/analytics";
import { getSiteSettings, getStrapiMediaUrl } from "@/lib/strapi";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();

  const title =
    settings?.metaTitle || settings?.siteName || "Acumen Blog";
  const description =
    settings?.metaDescription || settings?.siteDescription || "";
  const keywords = settings?.keywords || undefined;

  const ogImageUrl = settings?.ogImage?.data
    ? getStrapiMediaUrl(settings.ogImage.data.attributes.url)
    : undefined;

  return {
    title,
    description,
    ...(keywords ? { keywords } : {}),
    openGraph: {
      title,
      description,
      ...(ogImageUrl ? { images: [{ url: ogImageUrl }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImageUrl ? { images: [ogImageUrl] } : {}),
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetch site settings from Strapi for analytics configuration
  const siteSettings = await getSiteSettings();

  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <head>
        {/* Analytics scripts from Strapi Site Settings */}
        <Analytics settings={siteSettings} />
      </head>
      <body className="antialiased font-sans">
        {/* GTM NoScript fallback */}
        <GoogleTagManagerNoScript settings={siteSettings} />
        {/* Custom body scripts */}
        <CustomScripts settings={siteSettings} location="body" />

        <Header />
        <main className="min-h-screen">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}