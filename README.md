# SecureCloud RBAC

A frontend-only cloud-storage workspace demo built with React, Vite, TypeScript, Tailwind CSS, React Router, and Lucide.

## Run locally

```sh
npm install
npm run dev
```

`npm run build` runs the TypeScript project check and creates the production frontend bundle in `dist/`.

## Demo workspaces

- Public sign-up creates Student demo accounts only.
- Admin access is a predesignated demo identity (`admin@securecloud.demo`). The user-management screen can create Teachers and Students, but cannot create or assign another Admin.
- Use the **Preview as** selector in a workspace to switch between the Student, Teacher, and Admin panels. This is a UI preview control, not an authentication or authorization mechanism.
- The designated Admin can change the local PDF demo size limit (10, 25, or 50 MB) in Admin → Settings; it affects only the simulated file picker flow.
- File uploads, downloads, sharing, permissions, account changes, and activity are local demonstrations. Seed files contain metadata only; actual selected PDFs remain in browser memory and can be downloaded during the current app session.
- The encryption status is a placeholder. Files are not uploaded to cloud storage, encrypted, or protected by backend authorization.
- Login, sign-up, password reset, role changes, and account administration are not connected to an identity provider.

For a production version, connect Supabase Auth and trusted role records, enforce the single-Admin invariant through server-side logic and database policies, and implement secure storage and encryption before describing the system as secure.
