#!/bin/sh
# Wraps app.html (the page body) into a standalone index.html you can open or host anywhere.
cd "$(dirname "$0")"
{ printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="apple-mobile-web-app-capable" content="yes">\n</head>\n<body>\n'; cat app.html; printf '</body>\n</html>\n'; } > index.html
