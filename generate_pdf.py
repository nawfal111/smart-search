"""
generate_pdf.py  —  Generates smart_search_thesis.pdf from the HTML file.
Run: python generate_pdf.py
Requires: pip install weasyprint
  On Windows you also need GTK3 runtime:
  https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer
  OR use the alternative pdfkit method below (requires wkhtmltopdf).

If WeasyPrint does not install cleanly, use the browser method instead:
  1. Open smart_search_thesis.html in Chrome / Edge
  2. Press Ctrl+P
  3. Set Destination = "Save as PDF"
  4. Set Margins = "None" or "Minimum"
  5. Enable "Background graphics"
  6. Click Save
"""

import os
import sys

HTML_FILE = "smart_search_thesis.html"
PDF_FILE  = "smart_search_thesis.pdf"

def try_weasyprint():
    try:
        from weasyprint import HTML
        print("Using WeasyPrint...")
        HTML(filename=HTML_FILE).write_pdf(PDF_FILE)
        size = os.path.getsize(PDF_FILE)
        print(f"Done: {PDF_FILE} created ({size // 1024} KB)")
        return True
    except ImportError:
        return False
    except Exception as e:
        print(f"WeasyPrint error: {e}")
        return False

def try_pdfkit():
    try:
        import pdfkit
        print("Using pdfkit (wkhtmltopdf)...")
        options = {
            "page-size": "A4",
            "margin-top":    "20mm",
            "margin-bottom": "20mm",
            "margin-left":   "25mm",
            "margin-right":  "20mm",
            "encoding":      "UTF-8",
            "enable-local-file-access": None,
        }
        pdfkit.from_file(HTML_FILE, PDF_FILE, options=options)
        size = os.path.getsize(PDF_FILE)
        print(f"Done: {PDF_FILE} created ({size // 1024} KB)")
        return True
    except ImportError:
        return False
    except Exception as e:
        print(f"pdfkit error: {e}")
        return False

def browser_instructions():
    abs_path = os.path.abspath(HTML_FILE)
    print()
    print("Automatic PDF generation failed.")
    print("Use the browser method (produces the best-looking PDF):")
    print()
    print(f"  1. Open this file in Chrome or Edge:")
    print(f"     {abs_path}")
    print()
    print("  2. Press Ctrl+P (Print)")
    print("  3. Set Destination  = 'Save as PDF'")
    print("  4. Set Paper size   = 'A4'")
    print("  5. Set Margins      = 'None' or 'Minimum'")
    print("  6. Tick             'Background graphics'")
    print("  7. Click Save  ->  save as smart_search_thesis.pdf")
    print()
    print("  The result will be a near-perfect replica of the HTML thesis.")

def try_chrome():
    import subprocess
    import pathlib
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Users\%s\AppData\Local\Google\Chrome\Application\chrome.exe" % os.environ.get("USERNAME", ""),
    ]
    chrome = next((p for p in chrome_paths if os.path.exists(p)), None)
    if not chrome:
        return False
    abs_html = pathlib.Path(HTML_FILE).resolve().as_uri()
    abs_pdf  = str(pathlib.Path(PDF_FILE).resolve())
    print("Using Chrome headless...")
    result = subprocess.run([
        chrome,
        "--headless",
        "--disable-gpu",
        f"--print-to-pdf={abs_pdf}",
        "--print-to-pdf-no-header",
        abs_html,
    ], capture_output=True, text=True)
    if os.path.exists(PDF_FILE):
        size = os.path.getsize(PDF_FILE)
        print(f"Done: {PDF_FILE} created ({size // 1024} KB)")
        return True
    print(f"Chrome error: {result.stderr[-300:]}")
    return False


if __name__ == "__main__":
    if not os.path.exists(HTML_FILE):
        print(f"ERROR: {HTML_FILE} not found. Run from the project root directory.")
        sys.exit(1)

    if try_chrome():
        sys.exit(0)

    if try_weasyprint():
        sys.exit(0)

    if try_pdfkit():
        sys.exit(0)

    browser_instructions()
    sys.exit(1)
