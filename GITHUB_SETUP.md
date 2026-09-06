# Put Niche Numbers Treasury on GitHub

## 1. Create a GitHub account

Go to `github.com`, create an account, and verify your email address.

## 2. Install GitHub Desktop

Download GitHub Desktop from `desktop.github.com`, install it, and sign in. This avoids command-line setup.

## 3. Unzip the source copy

Download the supplied ZIP and unzip it into a normal folder such as `Documents/Niche Numbers Treasury`.

## 4. Add the folder to GitHub Desktop

1. Open GitHub Desktop.
2. Select **File → Add local repository**.
3. Choose the unzipped project folder.
4. If prompted, choose **Create a repository**.

Use these settings:

- Name: `niche-numbers-treasury`
- Description: `Modular Google Sheets treasury scenario tool`
- Keep the repository **Private** until you are ready to share it.

## 5. Publish it

Click **Publish repository**. Confirm that **Keep this code private** is selected, then publish.

## 6. Share with the team

On GitHub, open the repository, then choose **Settings → Collaborators → Add people**. Invite team members by their GitHub usernames or email addresses.

## 7. Host it on Vercel

Follow [VERCEL_SETUP.md](VERCEL_SETUP.md). Vercel can import this GitHub repository and deploy it as a Next.js application.

## 8. Run it on another computer

Install Node.js 22 or newer. In the project folder, run:

```bash
npm install
npm run dev
```

The terminal prints a local address to open in the browser.

## 9. Save future changes

In GitHub Desktop:

1. Review the changed files.
2. Add a short summary such as `Improve supplier payment mapping`.
3. Click **Commit to main**.
4. Click **Push origin**.

This creates a recoverable history of every version.
