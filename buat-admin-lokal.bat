@echo off
rem Membuat akun ADMIN baru di database lokal (laptop ini) — misalnya kalau
rem sandi akun admin lokal lupa. Username dan sandi diketik sendiri di
rem jendela ini; sandinya tidak ditampilkan dan tidak disimpan di file mana
rem pun. MySQL harus sudah menyala (jalankan-lokal.bat atau Laragon).
rem Login pertama dengan akun baru meminta memasang 2FA (scan QR
rem "Popside (Lokal)" dengan Google/Microsoft Authenticator).
title Popside - buat akun admin lokal
cd /d "%~dp0api"
call npm run create-admin
echo.
pause
