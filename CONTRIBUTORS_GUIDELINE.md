# 🌟 Contributing Guide | SafeTrust

We’re excited you’re interested in contributing! Please follow these steps to ensure a smooth and efficient collaboration process.

---

## 1️⃣ Fork the Repository

1. **Create a GitHub account** if you don’t already have one.
2. Navigate to the repository’s GitHub page.
3. Click the **Fork** button in the top-right corner to create a copy of the repository under your account.

---

## 2️⃣ Clone the Fork

1. Clone the forked repository to your local machine by running the following command:

   ```bash
   git clone https://github.com/YOUR_USERNAME/REPOSITORY_NAME.git
   ```

2. Replace `YOUR_USERNAME` and `REPOSITORY_NAME` with your GitHub username and the repository name.

---

## 3️⃣ Create a New Branch

1. **Follow branch naming conventions** outlined in the [Git Guidelines](./GIT_GUIDELINE.md).
2. Create a branch name based on the type of change (e.g., `feat/name-related-issue`, `fix/name-related-issue`).

   ```bash
   git checkout -b branch-name
   ```

   > Example: `feat/update-readme` or `fix/login-bug`.

---

## 4️⃣ Make Changes and Write Atomic Commits

1. Make changes in your local repository.
2. Follow **atomic commit principles**:

   - Each commit should address a single, logical change.
   - Avoid bundling unrelated changes in a single commit.
   - Write clear and descriptive commit messages using the format:

   ```bash
   git add .
   git commit -m "type(scope): description"
   ```

   > Examples:

   - `feat(authentication): add support for OAuth login`
   - `fix(api): resolve 404 error in user endpoint`
   - `docs(readme): update contribution guidelines`

---

## 5️⃣ Run the Project Locally

1. Ensure the project runs correctly after making your changes.
2. Follow the project-specific setup instructions to test your changes locally.

---

## 6️⃣ Push Your Changes

1. Push your changes to your forked repository:

   ```bash
   git push origin your-branch-name
   ```

2. ⚠️ **Note:** This repository uses Husky for pre-push hooks. Husky will automatically run `npm run format` and `npm run lint` before allowing the push.

   - If you encounter errors, fix any formatting or linting issues before retrying the push.

---

## 7️⃣ Create a Pull Request (PR)

1. Navigate to your forked repository on GitHub.
2. Click **New Pull Request** and select your branch to merge into the `main` of the original repository.
3. Use the **Pull Request Template** provided and fill it out properly.

⚠️ **Important:** Pull requests without the proper template or missing required details may be rejected.

---

## 💡 Additional Notes

- Follow the [Git Guidelines](./GIT_GUIDELINE.md) for branch naming, commit messages, and overall contribution standards.
- Make sure your code adheres to the repository’s coding standards.
- Respect the project maintainers' feedback and requested changes.

---

## 🔒 Security Checks

Every pull request to `main` runs the **Security** workflow (`.github/workflows/security.yml`):

1. **Code scanning (CodeQL):** Scans `webhook/src` JavaScript/TypeScript with `security-extended`.
2. **Dependency review:** Fails on new dependencies with `high` or `critical` advisories or known malware.
3. **Lockfile & package integrity:** Runs `lockfile-lint` (HTTPS, `registry.npmjs.org`, SHA integrity), `npm ci --ignore-scripts`, `npm audit signatures`, and `npm audit --omit=dev --audit-level=high` inside `webhook/`.
4. **Secret scanning:** Runs `gitleaks` against PR commits using `.gitleaks.toml`.
5. **Suspicious-code check:** Runs `scripts/check-suspicious-code.mjs` on PR-changed files for hidden Unicode (bidi/zero-width), off-screen long lines (`>500` chars), `eval` / `new Function` / `child_process` / `vm` usage, large base64 payloads, unchecked `curl | sh` / executable downloads, dangerous migration SQL, and overly broad non-admin Hasura permissions (`filter: {}` / `check: {}`).
6. **Workflow linting:** Runs `zizmor` and `actionlint` on `.github/workflows/**`.

### Running checks locally

```bash
node --test scripts/check-suspicious-code.test.mjs
git diff --name-only origin/main...HEAD | node scripts/check-suspicious-code.mjs --stdin
npx --prefix webhook lockfile-lint --path webhook/package-lock.json --type npm --allowed-hosts npm --validate-https --validate-integrity
```

### Handling false positives

- **Migrations (`migrations/**/*.sql`):** If a migration legitimately requires a flagged SQL keyword (for example `GRANT` or `SECURITY DEFINER`), add an inline `-- security-reviewed: <reason>` comment on that line so the check records the rationale in the job summary instead of failing.
- **Secrets (`.gitleaks.toml`):** Local test defaults belong in `.env.example` / `webhook/.env.example` or scoped `.gitleaks.toml` allowlist entries. Never commit real credentials or Stellar secret seeds (`S...`).
- **Install scripts:** CI and Docker builds run `npm ci --ignore-scripts`. Do not rely on package `postinstall` scripts without documenting and explicitly invoking them after maintainer review.

Thank you for contributing! 🚀✨
