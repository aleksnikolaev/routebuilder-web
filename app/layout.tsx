import type { Metadata } from "next";
import { landingMeta as m } from "@/lib/landing/meta";
import "./landing.css";

// Every value comes from the published page head, so the move to Next.js
// changes nothing a search engine or a link preview sees.
export const metadata: Metadata = {
	title: m.title,
	description: m.description,
	keywords: m.keywords,
	authors: [{ name: m.author }],
	robots: m.robots,
	other: { googlebot: m.googlebot },
	alternates: { canonical: m.canonical },
	openGraph: {
		type: m.ogType,
		siteName: m.ogSiteName,
		title: m.ogTitle,
		description: m.ogDescription,
		url: m.ogUrl,
		locale: m.ogLocale,
	},
	twitter: {
		card: m.twitterCard,
		title: m.twitterTitle,
		description: m.twitterDescription,
	},
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en">
			<head>
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
				<link href={m.fonts} rel="stylesheet" />
			</head>
			<body>{children}</body>
		</html>
	);
}
