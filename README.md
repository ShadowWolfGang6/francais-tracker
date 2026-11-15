# Français — Immersion Tracker

A mobile-friendly French-learning planner with private journals and progress sync. The GitHub Pages workflow publishes the frontend from `main`.

[Open the tracker](https://shadowwolfgang6.github.io/francais-tracker/).

## Set up the email accounts

1. Use a Supabase project you own. Apply the SQL in `supabase/migrations/20261115024151_tracker_journal.sql` using the project's SQL editor or migrations workflow. The migration exposes two authenticated RPCs and keeps the underlying journal tables in a private schema.
2. In Authentication → URL Configuration, set the Site URL to `https://shadowwolfgang6.github.io/francais-tracker/`. Keep email sign-ups and email confirmation enabled. Set the minimum password length to 12.
3. The default Supabase confirmation and reset emails work with the tracker’s Site URL. For tracker-specific emails, use the optional templates in `supabase/templates/`.
4. Configure custom SMTP in Supabase with a verified sender and disable click tracking for the auth emails. Enter the SMTP credentials in Supabase. The default Supabase mailer delivers only to project-team addresses.
5. Set `projectUrl` and `publishableKey` in `journal/supabase-config.js` using the HTTPS project URL and the public `sb_publishable_…` key. Check registration, confirmation, sign-in, and password reset with an external email address, then publish.
6. With two test accounts, log progress in one and verify the other starts with an empty journal. Sign in to the first account in another browser to verify sync.

[Supabase password authentication](https://supabase.com/docs/guides/auth/passwords) · [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Carry over progress

For a journal previously synced through ChatGPT, open the earlier journal, choose **Progress → Export my data**, then sign into the new email account and choose **Progress → Import backup**. For progress from the browser-only tracker, use **Import old progress from this browser** on the device where you logged it.

## Add to iPhone Home Screen

Open the tracker in Safari, tap Share, and choose **Add to Home Screen**.

## Frontend

`journal/vendor/supabase-2.119.0.js` is the browser bundle from `@supabase/supabase-js` 2.119.0. Its license is in the same directory.
