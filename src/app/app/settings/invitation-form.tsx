"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { inviteMemberAction } from "../actions";
import styles from "./settings-sections.module.css";

type IssuedInvitation = Awaited<ReturnType<typeof inviteMemberAction>>;
type CreatedInvitation = Omit<IssuedInvitation, "invitationPath"> & { invitationUrl: string };

export function InvitationForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const linkField = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [invitation, setInvitation] = useState<CreatedInvitation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clearLink = () => setInvitation(null);
    window.addEventListener("pagehide", clearLink);
    return () => window.removeEventListener("pagehide", clearLink);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setInvitation(null);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const created = await inviteMemberAction(formData);
        form.reset();
        setInvitation({
          invitationId: created.invitationId,
          email: created.email,
          expiresAt: created.expiresAt,
          invitationUrl: new URL(created.invitationPath, window.location.origin).toString(),
        });
      } catch {
        setError("The invitation could not be created. Your entries are still shown so you can try again.");
      }
    });
  }

  async function copyLink() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.invitationUrl);
      setInvitation(null);
      setError(null);
      setMessage("Copied. The link is no longer shown here.");
    } catch {
      linkField.current?.focus();
      linkField.current?.select();
      setError("Copy failed. Select the link and copy it manually.");
    }
  }

  return <>
    {invitation && <div className={styles.invitationResult} role="status">
      <div>
        <b>Copy this invitation link now</b>
        <p>Share it with {invitation.email}. It expires on {new Date(invitation.expiresAt).toLocaleDateString("en-GB")}. You cannot retrieve it after closing this message.</p>
      </div>
      <label>
        Invitation link
        <input ref={linkField} readOnly value={invitation.invitationUrl} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <div className={styles.invitationResultActions}>
        <button type="button" className="button primary" onClick={copyLink}>Copy invitation link</button>
        <button type="button" className="button secondary" onClick={() => setInvitation(null)}>Done</button>
      </div>
    </div>}
    {message && <p className={styles.statusMessage} role="status">{message}</p>}
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <form onSubmit={submit} aria-busy={pending} className={styles.inviteForm}>
      <label>Invite by email<input type="email" name="email" required placeholder="member@example.com" /></label>
      <label>Job title<input name="jobTitle" maxLength={120} placeholder="Developer, CTO, Employee…" /></label>
      <label>Role<select name="role"><option value="member">Member</option>{canInviteAdmin && <option value="admin">Admin</option>}</select></label>
      <button className="button primary" disabled={pending}><Icon name="plus" />{pending ? "Creating…" : "Create invite"}</button>
    </form>
  </>;
}
