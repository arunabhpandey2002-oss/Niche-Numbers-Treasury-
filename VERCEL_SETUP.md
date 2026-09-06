# Put Niche Numbers Treasury on Vercel

This guide assumes you have not hosted a website before.

## Part 1: Download and unzip

1. Download `niche-numbers-treasury-vercel.zip`.
2. Double-click the ZIP to extract it.
3. Keep the extracted folder somewhere permanent, such as Documents.

## Part 2: Put the project on GitHub

1. Create an account at [github.com](https://github.com/).
2. Install [GitHub Desktop](https://desktop.github.com/) and sign in.
3. In GitHub Desktop, choose **File → Add Local Repository**.
4. Select the extracted `niche-numbers-treasury-vercel` folder.
5. If GitHub Desktop says it is not a repository, click **Create a Repository**.
6. Use the name `niche-numbers-treasury` and keep it private initially.
7. Click **Publish Repository**.

## Part 3: Deploy on Vercel

1. Create an account at [vercel.com](https://vercel.com/) using your GitHub account.
2. From the Vercel dashboard, click **Add New → Project**.
3. Find `niche-numbers-treasury` and click **Import**.
4. Vercel should automatically select **Next.js** as the framework.
5. Leave the root directory as `./`.
6. Do not add environment variables for this version.
7. Click **Deploy**.
8. When deployment finishes, Vercel will give you a public web address.

## Part 4: Connect Google Sheets

Vercel hosts the interface. Google Apps Script continues to read and write the spreadsheet.

1. Open a Google Sheet controlled by the Google account that can access your financial models.
2. Choose **Extensions → Apps Script**.
3. Copy the complete contents of `google-apps-script/Code.gs` into the editor.
4. Replace `REPLACE_WITH_A_LONG_RANDOM_TOKEN` with a private random value.
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**.
7. Deploy and copy the URL ending in `/exec`.
8. Open your Vercel website and click **Connect sheet**.
9. Paste the target Google Sheet URL, Apps Script URL and the same private token.
10. Click **Save and scan workbook**.

## Part 5: Use Ask the Model

1. Create a Groq API key in your Groq account.
2. Open the **Summary** tab in Niche Numbers Treasury.
3. Paste the Groq key into the assistant field.
4. The key stays only in the current browser tab and is not stored by this app.

## Updating the website later

1. Make or receive changes in the project folder.
2. Open GitHub Desktop.
3. Enter a short summary, then click **Commit to main**.
4. Click **Push origin**.
5. Vercel automatically deploys the new GitHub version.

## Common problems

- **Vercel build fails:** confirm the project root contains `package.json` and that Vercel detected Next.js.
- **Sheet does not connect:** confirm the Apps Script URL ends in `/exec`, access is set to Anyone, and the token matches exactly.
- **Sheet changes do not appear:** deploy a new Apps Script version, then refresh and scan the workbook again.
- **Groq returns an authentication error:** create a new Groq key and paste it again. The app does not remember keys after the tab closes.
