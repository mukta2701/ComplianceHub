# Milestone 1 AWS dev role rehearsal, 25 September 2026

This is hosted AWS dev evidence from the existing Adtecher/Maiself workspace. It is not production acceptance or proof of the remaining live GitHub and Slack checks. The tests used two disposable `@example.test` accounts. No passwords or invitation links are stored here.

## What worked

- The signed-in Owner created separate Admin and Member invitations in Settings.
- Each invited user signed in, accepted their invitation, and reached the workspace. The Admin saw the Admin view. The Member saw the Member view.
- The Admin could read the one selected GitHub connection and its permissions, but could not manage repository access. A direct Member request to Connections returned to the Member overview.
- After the tests, both users signed out. A fresh server-side check found zero memberships for either test user. Both Auth users were soft-deleted, and neither record retained its original test email.

## Defects and limits

- The invite correctly refused acceptance while the browser was signed in as a different email. But after "Switch account" and sign-in as the invited user, `/invite` showed "Invitation unavailable". Reopening the same valid invitation link restored the invitation. This happened in both role tests. The cause is not confirmed; the fix is not implemented or deployed.
- Hard deletion of one test Auth user failed because it tried to change an immutable audit event. Removing its workspace membership and soft-deleting the Auth user succeeded. The same safe cleanup was used for the second account. Audit history and Auth tombstones remain by design of the workaround.
- This rehearsal proves only the observed Owner, Admin, and Member paths above. It does not prove every permission, a fresh GitHub collection, a new private Slack alert, an unattended scheduled run, or final Owner acceptance.
