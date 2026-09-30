@echo off
setlocal
rem ==================================================================
rem  Popside MODE WIFI: laptop ini jadi server, dan HP/laptop lain yang
rem  tersambung ke WiFi yang SAMA bisa membuka dashboard admin dan menu
rem  customer — termasuk memindai QR meja pakai HP.
rem  Klik dua kali file ini. Server Popside yang sedang berjalan dinyalakan
rem  ulang dalam mode WiFi (MySQL tetap).
rem  Kembali ke mode biasa: tutup jendela "Popside ... (WiFi)" di taskbar,
rem  lalu klik dua kali jalankan-lokal.bat.
rem ==================================================================
title Popside - mode WiFi
cd /d "%~dp0"

set "MYSQL_DIR=C:\laragon\bin\mysql\mysql-8.0.30-winx64"

rem ---- Alamat laptop ini di WiFi (mis. 192.168.18.13).
set "IP="
for /f "delims=" %%i in ('node "%~dp0api\scripts\ip-wifi.js" 2^>nul') do set "IP=%%i"
if not defined IP (
  echo Laptop belum tersambung ke WiFi atau jaringan. Sambungkan dulu, lalu jalankan file ini lagi.
  goto gagal
)
echo Alamat laptop ini di WiFi: %IP%
echo.

rem ---- Hentikan server Popside yang sedang berjalan (bukan MySQL).
echo Menghentikan server Popside yang sedang berjalan...
for %%t in ("Popside API*" "Popside Admin*" "Popside Menu*") do taskkill /FI "WINDOWTITLE eq %%~t" /T /F >nul 2>&1
for %%p in (3000 5173 5174) do call :hentikanPort %%p
ping -n 3 127.0.0.1 >nul

call :sudahMenyala 3306 && (echo [1/4] MySQL sudah menyala.) || (
  echo [1/4] Menyalakan MySQL Laragon...
  if not exist "%MYSQL_DIR%\bin\mysqld.exe" (
    echo       MySQL Laragon tidak ditemukan di %MYSQL_DIR%.
    echo       Buka aplikasi Laragon lalu klik "Start All", kemudian jalankan file ini lagi.
    goto gagal
  )
  start "Popside MySQL" /min "%MYSQL_DIR%\bin\mysqld.exe" --defaults-file="%MYSQL_DIR%\my.ini" --standalone --console
  call :tunggu 3306 "MySQL" || goto gagal
)

rem Link & QR meja memakai alamat WiFi, supaya bisa dibuka/dipindai dari HP.
echo [2/4] Menyalakan server API (mode WiFi)...
start "Popside API (WiFi)" /min /D "%~dp0api" cmd /k "set PUBLIC_WEB_URL=http://%IP%:5174&& npm run start"
call :tunggu 3000 "Server API" || goto gagal

rem Dashboard & menu terbuka untuk jaringan (--host); panggilan /api-nya
rem diteruskan Vite ke server API di laptop ini (vite.config.js proxy).
echo [3/4] Menyalakan dashboard admin (mode WiFi)...
start "Popside Admin (WiFi)" /min /D "%~dp0admin-web" cmd /k "set VITE_API_URL=/api&& npm run dev -- --host"
call :tunggu 5173 "Dashboard admin" || goto gagal

echo [4/4] Menyalakan web menu (mode WiFi)...
start "Popside Menu (WiFi)" /min /D "%~dp0public-web" cmd /k "set VITE_API_URL=/api&& npm run dev -- --host"
call :tunggu 5174 "Web menu" || goto gagal

echo.
echo  Siap! Dari HP/laptop lain yang tersambung ke WiFi yang SAMA, buka:
echo    Dashboard admin : http://%IP%:5173
echo    Menu customer   : pindai QR di dashboard (Meja ^> Lihat / Cetak), atau:
pushd "%~dp0api"
set "PUBLIC_WEB_URL=http://%IP%:5174"
call node scripts\link-meja-lokal.js
popd
echo.
echo  Di laptop ini sendiri tetap bisa lewat http://localhost:5173
echo  Perangkat lain tidak bisa membuka? Pastikan WiFi-nya sama. Kalau Windows
echo  menanyakan izin untuk Node.js, pilih Izinkan (Allow).
echo  Ingat: sebelum customer memesan, tekan "Mulai Shift" di dashboard.
echo  Kembali ke mode biasa: tutup jendela "Popside ... (WiFi)", lalu jalankan-lokal.bat.
echo.
start "" http://localhost:5173
pause
exit /b 0

:gagal
echo.
echo  Ada yang belum menyala. Lihat pesan di jendela "Popside ..." yang terbuka.
pause
exit /b 1

rem ---- hentikanPort <port>: menghentikan proses yang mendengarkan di port itu.
:hentikanPort
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%~1 .*LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1
exit /b 0

rem ---- sudahMenyala <port>: berhasil kalau ada yang mendengarkan di port itu.
:sudahMenyala
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul
exit /b %errorlevel%

rem ---- tunggu <port> <nama>: menunggu sampai 90 detik.
:tunggu
for /l %%i in (1,1,90) do (
  netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul && exit /b 0
  ping -n 2 127.0.0.1 >nul
)
echo       %~2 belum menyala setelah 90 detik.
exit /b 1
