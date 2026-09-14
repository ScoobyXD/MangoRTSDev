# Current [CTRL] Loop Landing Page Business Logic Laws

1. The public landing page must run independently of Mango sign-in and product APIs.
2. Every primary call to action must open the working sample until a real conversion destination is supplied.
3. The sample must identify its purchase orders and emails as fictional demonstration data.
4. Selecting Vendor confirmation, Buyer approval, or Color approval must show the sample email for that exact purchase order and stage.
5. Apply sample email must write that email's receipt timestamp to only its matching purchase-order row and stage cell.
6. Applying a sample email must preserve every unrelated row and cell.
7. Opening a stamped cell must show the exact fictional email that supplied its timestamp, even after another stage is selected.
8. The source-email dialog must support keyboard opening, dismissal, and return of focus to its opener.
9. The page must collect no visitor information, connect no real inbox or workbook, and send no email.
10. The copy must describe Excel WIPs as the initial direction and label Google Sheets support and outgoing workflows as planned.
11. The copy must explain that each purchase-order row can follow the company's own stages without claiming a working public workflow builder.
12. Marketing claims must not invent customers, testimonials, pricing, certifications, or available integrations.
13. Navigation, sample controls, and native FAQ disclosures must remain usable by keyboard and at mobile widths.
14. The landing build must contain only its public assets and must not publish repository source, backend files, or local configuration.
15. Both ctrlloop.io and www.ctrlloop.io must serve the landing page over HTTPS and redirect HTTP requests to HTTPS.
16. The landing assets must live in a dedicated private S3 bucket that grants read access only to the site's CloudFront distribution.
17. Landing deployments must publish only frontend/dist-landing and preserve Mango's existing hosting and DNS.
18. Ctrl Loop infrastructure must use its own Terraform state key in AWS account 686458136219.

## Verification — September 14, 2026

1. `npm --prefix frontend run build:landing` passed TypeScript checking and the Vite production build.
2. The public output contains only `index.html`, the favicon, and the landing CSS/JavaScript bundles; it imports no Mango authentication, API, or application modules.
3. Browser checks exercised all three email scenarios, confirmed C2/D3/E2 receipt timestamps, preserved unrelated cells, and reset the sample.
4. Opening the vendor timestamp after selecting color approval showed the original vendor email. Escape closed the native dialog and returned focus to its timestamp button.
5. Desktop (1440px), mobile (390px), and narrow mobile (320px) layouts were inspected. The sheet scrolls within its own region without widening the page.
6. Mobile navigation, primary sample CTAs, FAQ disclosures, and keyboard sample/dialog controls worked. All local anchor targets exist; the compiled page reported no app console errors.
7. Public deployment checks passed for apex/www HTTPS, HTTP redirects, all website assets, desktop/mobile sample interactions, source-dialog focus, and FAQ navigation. Direct S3 access returned 403; the final Terraform plan reported no changes.

## Local preview

From the repository root, run `npm --prefix frontend run dev:landing -- --port 5180 --strictPort`, then open `http://127.0.0.1:5180/`.

To review exactly the public build, run `npm --prefix frontend run build:landing`, then `npm --prefix frontend run preview:landing -- --port 5181 --strictPort` and open `http://127.0.0.1:5181/`.

The landing page reuses the existing frontend dependencies. It has no form or external conversion destination because none has been supplied. AWS deployment details are recorded in `docs/infra/ctrl-loop-landing.md`.
