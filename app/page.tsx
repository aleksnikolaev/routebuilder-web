import Script from "next/script";
import { bodyAfterForm, bodyBeforeForm } from "@/lib/landing/body";
import { landingJsonLd } from "@/lib/landing/jsonld";
import { landingMeta } from "@/lib/landing/meta";
import LeadForm from "./lead-form";

export default function Home() {
	return (
		<>
			{landingJsonLd.map((json, i) => (
				<script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
			))}
			{/* The published markup is carried over as is; display: contents keeps the wrappers out of the layout. */}
			<div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: bodyBeforeForm }} />
			<LeadForm />
			<div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: bodyAfterForm }} />
			<Script src="/landing.js" strategy="afterInteractive" />
			<Script
				src="https://static.cloudflareinsights.com/beacon.min.js"
				data-cf-beacon={landingMeta.cfBeacon}
				strategy="afterInteractive"
			/>
		</>
	);
}
