@echo off
setlocal
rem ==================================================================
rem  Popside di laptop ini (localhost), tanpa hosting.
rem  Klik dua kali file ini. Yang dinyalakan, kalau belum menyala:
rem    1. MySQL Laragon (database lokal)   port 3306
rem    2. Server API                        port 3000
rem    3. Dashboard admin                   http://localhost:5173
rem    4. Web menu customer                 http://localhost:5174
rem  Setelah siap, dashboard dan menu customer Meja pertama terbuka di browser;
rem  link menu semua meja ditampilkan di jendela ini.
rem  Yang sudah menyala dilewati, jadi aman diklik berkali-kali.
rem  Untuk mematikan: tutup jendela-jendela "Popside ..." di taskbar.
rem ==================================================================
title Popside - jalankan lokal
cd /d "%~dp0"

set "MYSQL_DIR=C:\laragon\bin\mysql\mysql-8.0.30-winx64"

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

rem Server API memakai "npm run start" (bukan "dev"): mode --watch di Windows
rem bisa restart berulang-ulang sendiri.
call :sudahMenyala 3000 && (echo [2/4] Server API sudah menyala.) || (
  echo [2/4] Menyalakan server API...
  start "Popside API" /min /D "%~dp0api" cmd /k npm run start
  call :tunggu 3000 "Server API" || goto gagal
)

call :sudahMenyala 5173 && (echo [3/4] Dashboard admin sudah menyala.) || (
  echo [3/4] Menyalakan dashboard admin...
  start "Popside Admin" /min /D "%~dp0admin-web" cmd /k npm run dev
  call :tunggu 5173 "Dashboard admin" || goto gagal
)

call :sudahMenyala 5174 && (echo [4/4] Web menu sudah menyala.) || (
  echo [4/4] Menyalakan web menu...
  start "Popside Menu" /min /D "%~dp0public-web" cmd /k npm run dev
  call :tunggu 5174 "Web menu" || goto gagal
)

echo.
echo  Siap!
echo    Dashboard admin : http://localhost:5173
echo    Web menu customer (sama dengan QR di tiap meja):
pushd "%~dp0api"
call node scripts\link-meja-lokal.js
set "MENU_URL="
for /f "delims=" %%u in ('node scripts\link-meja-lokal.js --pertama 2^>nul') do set "MENU_URL=%%u"
popd
echo.
echo  Ingat: sebelum customer memesan, tekan "Mulai Shift" di dashboard.
echo  Untuk mematikan, tutup jendela-jendela "Popside ..." di taskbar.
echo.
start "" http://localhost:5173
if defined MENU_URL start "" "%MENU_URL%"
pause
exit /b 0

:gagal
echo.
echo  Ada yang belum menyala. Lihat pesan di jendela "Popside ..." yang terbuka.
pause
exit /b 1

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
