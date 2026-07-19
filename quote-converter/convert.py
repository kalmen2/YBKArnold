import os
import shutil
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue


def property_value(name, value):
    prop = PropertyValue()
    prop.Name = name
    prop.Value = value
    return prop


def wait_for_connection(port, attempts=80):
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    last_error = None
    for _ in range(attempts):
        try:
            context = resolver.resolve(
                f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
            )
            return context
        except Exception as error:
            last_error = error
            time.sleep(0.1)
    raise RuntimeError(f"Could not connect to LibreOffice: {last_error}")


def convert(input_path, output_path):
    profile_directory = tempfile.mkdtemp(prefix="lo-profile-")
    port = 20000 + (os.getpid() % 20000)
    process = subprocess.Popen(
        [
            "libreoffice",
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            f"-env:UserInstallation=file://{profile_directory}",
            f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ServiceManager",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    document = None
    try:
        context = wait_for_connection(port)
        service_manager = context.ServiceManager
        desktop = service_manager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        input_url = uno.systemPathToFileUrl(os.path.abspath(input_path))
        document = desktop.loadComponentFromURL(
            input_url,
            "_blank",
            0,
            (property_value("Hidden", True), property_value("ReadOnly", True)),
        )
        if document is None:
            raise RuntimeError("LibreOffice could not open the workbook.")

        style_families = document.getStyleFamilies()
        page_styles = style_families.getByName("PageStyles")
        for style_name in page_styles.getElementNames():
            style = page_styles.getByName(style_name)
            try:
                style.IsLandscape = False
                style.Width = 21590
                style.Height = 27940
                style.ScaleToPagesX = 1
                style.ScaleToPagesY = 0
                style.CenterHorizontally = True
            except Exception:
                pass

        output_url = uno.systemPathToFileUrl(os.path.abspath(output_path))
        document.storeToURL(
            output_url,
            (
                property_value("FilterName", "calc_pdf_Export"),
                property_value("Overwrite", True),
            ),
        )
    finally:
        if document is not None:
            try:
                document.close(True)
            except Exception:
                pass
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(profile_directory, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: convert.py <input-workbook> <output-pdf>")
    convert(sys.argv[1], sys.argv[2])
