# Eaziply — Free Browser-Based PDF Toolkit

A static website for GitHub + Vercel. No custom backend, database, paid API, or API key is required.

## Included tools

- Merge PDFs (multiple files, manually reorder them before processing)
- Split selected pages into individual PDF files in a ZIP
- Extract selected pages into a new PDF
- Delete selected pages
- Rotate all or selected pages
- Combine JPG/PNG and browser-supported images into a PDF
- Render selected PDF pages to JPG/PNG images in a ZIP
- Sign PDF with a typed name (6 visual styles), drawn signature, or uploaded signature image
- Save up to 8 reusable signature images in the browser local storage on the visitor's device
- Continuous vertical multi-page editor view for Sign PDF and Fill & add text, with a persistent page counter and exact page-number jump
- Add multiple movable/resizable signature and text overlays on different pages
- Place editable text boxes directly on a PDF page; choose font, size and color
- Option to visually cover old text with a white patch before adding replacement text (not a true rewrite of the original text layer)
- Add a text watermark
- Add page numbers
- Basic PDF optimization/re-save (may not shrink all files; does not aggressively recompress embedded images)

## How it works

The site is static HTML/CSS/JavaScript. The PDF operations run in the user's browser with `pdf-lib`, PDF.js, and JSZip loaded from public CDNs. There is no paid API or document-processing backend. The browser needs an internet connection to load these libraries; selected PDF/image documents are processed locally and are not uploaded to an Eaziply processing server.

### Libraries

- `pdf-lib` 1.17.1 — PDF creation/modification and page operations (MIT-licensed project)
- `pdfjs-dist` 3.11.174 — in-browser PDF rendering (Apache-2.0 project)
- `jszip` 3.10.1 — browser ZIP exports (MIT-licensed project)

Review the current library licenses and versions before making a commercial release. Third-party CDN providers may receive ordinary requests for library files.

## GitHub + Vercel deployment

1. Download and extract this ZIP.
2. Create a new GitHub repository (suggested name: `eaziply`).
3. Upload **all files inside this folder** to the repository root. `index.html` must be at the root, not inside another nested directory.
4. In Vercel, choose **Add New → Project**, import the GitHub repository, choose **Other** as the framework preset, leave the build command blank, and deploy the root directory.
5. Test the tools with sample PDFs and images. Keep copies of the originals.
6. Once Vercel gives you the final public URL, the included `sitemap.xml` and `robots.txt` use `https://eaziply.vercel.app/`. If your Vercel URL changes, update both files before submitting the sitemap to Google Search Console.

## Test checklist

- Merge two sample PDFs and verify page order.
- Extract and delete selected pages from a test PDF.
- Rotate a page and verify it in a PDF viewer.
- Create a PDF from two JPG/PNG images.
- Export a short PDF to image files and open the ZIP.
- Type, draw, and upload a test signature; test the continuous page stack, exact page jump (for example page 20 of 33), saved-signature reuse after refresh, page-specific signatures, dragging/resizing, and complete-document export.
- Add text, a watermark, and page numbers.
- Try basic optimization and compare the actual file size; this tool does not promise a smaller file.
- Test on desktop and mobile with a small PDF first.

## Known limitations

- This is a useful first version, not a full replacement for every iLovePDF/Sejda capability.
- High-quality PDF-to-Word/Excel conversion, OCR for scanned documents, password unlock/protection, repair of damaged files, and certificate-based digital signatures are not implemented.
- Password-protected/encrypted PDFs may fail to open.
- PDF-to-image export creates raster images; it does not preserve selectable text in those images.
- Large documents can use substantial browser memory. The PDF-to-image tool caps one export at 40 pages and split ZIP exports at 80 pages.
- Saved signatures are stored in browser local storage on the current device; users should not save them on shared devices.
- A visible signature mark is not a certificate-based cryptographic signature or proof of identity.
- Existing PDF text is not directly edited; the optional white cover is a visual overlay and is safest on plain backgrounds. Confirm the recipient's requirements for important/legal documents.
- The first version uses external CDNs for JavaScript libraries, so the app itself will need internet access to load unless the libraries are later bundled with the repository.

## Contact

`udc.officialteam@gmail.com`
