"use client";

import { useRef, useState, type FormEvent } from "react";
import { submitLead, type Pending } from "@/lib/client/submission";
import styles from "./lead-form.module.css";

type State = "idle" | "sending" | "sent" | "rate_limited" | "invalid" | "failed";

const STATUS: Record<Exclude<State, "idle" | "sending">, string> = {
	sent: "Sent. Thank you.",
	rate_limited: "Too many requests from this address. Please try later or use the channels above.",
	invalid: "Please check your name and email.",
	failed: "Could not send right now. Please use email or WhatsApp above.",
};

export default function LeadForm() {
	const [state, setState] = useState<State>("idle");
	// The last attempt that did not get a success answer. Its id is reused only
	// for the same content; see lib/client/submission.ts.
	const pending = useRef<Pending>(null);

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const fields = Object.fromEntries(
			Array.from(new FormData(form).entries(), ([key, value]) => [key, typeof value === "string" ? value : ""]),
		);
		setState("sending");
		const result = await submitLead(fields, pending.current, {
			send: (body) =>
				fetch("/api/lead", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				}),
			newId: () => crypto.randomUUID(),
		});
		pending.current = result.pending;
		if (result.outcome === "sent") {
			form.reset();
		}
		setState(result.outcome);
	}

	return (
		<section className={styles.section} aria-label="Request a call">
			<div className={`container ${styles.grid}`}>
				<div className={styles.spacer} aria-hidden="true" />
				<form className={styles.form} onSubmit={onSubmit} data-lead-form>
					<label className={styles.field}>
						<span className={styles.label}>Name</span>
						<input className={styles.input} name="name" autoComplete="name" required maxLength={120} />
					</label>
					<label className={styles.field}>
						<span className={styles.label}>Work email</span>
						<input className={styles.input} name="email" type="email" autoComplete="email" required maxLength={200} />
					</label>
					<label className={styles.field}>
						<span className={styles.label}>Company</span>
						<input className={styles.input} name="company" autoComplete="organization" maxLength={160} />
					</label>
					<label className={styles.field}>
						<span className={styles.label}>Message</span>
						<textarea className={styles.textarea} name="message" rows={3} maxLength={4000} />
					</label>
					{/* Hidden from people; bots that fill every field land here. */}
					<div className={styles.honeypot} aria-hidden="true">
						<label>
							Website
							<input name="website" tabIndex={-1} autoComplete="off" />
						</label>
					</div>
					<div className={styles.actions}>
						<button className={styles.button} type="submit" disabled={state === "sending"}>
							{state === "sending" ? "Sending" : "Send request"} <span aria-hidden="true">→</span>
						</button>
						<p className={styles.status} role="status" aria-live="polite">
							{state === "idle" || state === "sending" ? "" : STATUS[state]}
						</p>
					</div>
				</form>
			</div>
		</section>
	);
}
