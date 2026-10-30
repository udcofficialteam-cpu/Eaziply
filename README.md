# Eaziply — Free Browser-Based PDF Toolkit

A static website for GitHub + Vercel. No custom backend, database, paid API, or API key is required.

## Included tools

- Merge PDFs (multiple files, reorder before processing)
- Split selected pages into individual PDF files in a ZIP
- Extract selected pages into a new PDF
- Delete selected pages
- Rotate all or selected pages
- Combine JPG/PNG and browser-supported images into a PDF
- Render selected PDF pages to JPG/PNG images in a ZIP
- **Unified Fill & Sign PDF editor** with Text, Forms, Sign and Select modes
- Add text watermarks and page numbers
- Basic PDF optimization/re-save (may not shrink every file; does not aggressively recompress embedded images)

## Fill & Sign editor

The single **Fill & Sign PDF** tool opens one workspace inspired by common professional PDF editor workflows. All pages are shown in a continuous vertical stack, and the sticky `‹ page / total ›` control remains available. Type a page number and press Enter to jump directly to that page; scrolling updates the current page number.

### Sign

- Type a name and select from 12 handwriting-style fonts.
- Draw with a mouse, trackpad or touch screen.
- Upload a signature image (transparent PNG recommended).
- Save up to eight signature images in the same browser/device and reuse or delete them later.
- Click any page to place the selected signature; drag to move and use corner handles to resize.
- Use **Repeat on all pages** to repeat the active page's placed items on pages without page-specific items.

### Text

- Select Text, then click a PDF page to create a directly editable text box.
- Type or paste text; adjust font, size, colour, alignment, bold and italic.
- Drag or resize the box. Duplicate or remove placed items.
- Optional **Cover old text** adds a white patch behind replacement text. This is a visual cover, not a rewrite of the original PDF text layer, and it works best on plain backgrounds.

### Forms

- Detect and fill supported interactive AcroForm text fields, checkboxes, dropdowns, option lists and radio fields.
- When the PDF is a flat scan or has no interactive fields, use Text and Sign to place items manually.

### Export

**Apply changes & Download** writes all placed signatures, added text and changed supported form-field values into one complete PDF. The original file remains unchanged.

## Important limitations

- This is an original Eaziply implementation inspired by common PDF-editor workflows, not a pixel-for-pixel Sejda clone.
- It can add visible text/signatures and fill supported interactive PDF form fields. It cannot universally rewrite arbitrary original text objects in every PDF. The white-cover replacement is only a visual overlay; it may cover nearby lines or images. Scanned PDFs need manual placement.
- A visible signature is not a certificate-based cryptographic digital signature and does not independently verify identity.
- Password-protected/encrypted PDFs may fail to open.
- PDF-to-image export creates raster images; it does not preserve selectable text in those images.
- Large documents can use substantial browser memory. PDF-to-image export is limited to 40 pages per task; split ZIP exports are limited to 80 pages.
- Saved signatures are stored in local storage on the current browser/device. Do not save sensitive signatures on shared or untrusted devices.

## How it works

The site is static HTML/CSS/JavaScript. PDF operations run in the visitor's browser with `pdf-lib`, PDF.js and JSZip loaded from public CDNs. No paid API or document-processing backend is used. An internet connection is required to load the site libraries and handwriting fonts. Selected PDF/image content is processed locally and is not uploaded to an Eaziply processing server. Third-party CDN providers receive ordinary requests for the static library/font files.

## GitHub + Vercel deployment

1. Download and extract the website ZIP.
2. Create or open your GitHub repository (suggested name: `eaziply`).
3. Upload all files in this folder to the repository root. `index.html` must be at the root, not inside another folder.
4. In Vercel, import the GitHub repository, choose **Other** as the framework preset, leave the build command blank, and deploy the root directory.
5. Test the tools with small sample PDFs before using important documents. Keep copies of originals.
6. `robots.txt` and `sitemap.xml` use `https://eaziply.vercel.app/`. Update both if your public URL changes.

## Test checklist

- Merge two PDFs and verify page order.
- Split, extract, delete and rotate pages.
- Convert JPG/PNG images to PDF and PDF pages to JPG/PNG.
- In Fill & Sign, upload a multi-page test PDF (for example 33 pages) and check the continuous stack.
- Type `20` into the page control and press Enter; verify page 20 appears.
- Create a typed signature, save it, switch to another tool, reopen Fill & Sign and verify it is still available.
- Draw and upload a signature; place, drag, resize, duplicate and remove it.
- Add text on different pages, edit it directly, format it, move and resize it.
- Test a PDF with interactive AcroForm fields and check that changed values appear in the downloaded file.
- Download the full PDF and reopen it in a PDF reader to verify every edited page.
- Repeat on desktop and mobile. Try a small file first.

## Contact

`udc.officialteam@gmail.com`
