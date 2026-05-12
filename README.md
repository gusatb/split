# Split Design

A Vite + React + TypeScript single page implementation of the Split Design game.

## Scripts

- `npm run dev` - start the local Vite dev server
- `npm run build` - type-check and build the SPA
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint

The app is configured with `base: '/split/'` for GitHub Pages deployment.

## Supabase

The Supabase GitHub Integration should use `.` as the working directory because the
`supabase/` directory lives at the repository root.

If the integration reports:

```text
relation "supabase_migrations.schema_migrations" does not exist
```

run `supabase/bootstrap_schema_migrations.sql` once in the Supabase SQL editor,
then re-run the integration/migration check. After that, normal migrations in
`supabase/migrations/` should apply through the integration.

If the deployed app reports:

```text
Could not find the table 'public.games' in the schema cache Code: PGRST205
```

run `supabase/setup_online_play.sql` once in the Supabase SQL editor. This
creates the online-play table/policies and sends `notify pgrst, 'reload schema'`
so PostgREST can see the table.
