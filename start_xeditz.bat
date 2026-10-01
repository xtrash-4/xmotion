@echo off
rem Menjalankan server XEDITZ Studio lalu membuka Chrome dengan hardware video decode dimatikan.
rem Alasan: di PC ini decoder video hardware Chrome mereset GPU sehingga semua WebGL hilang
rem saat preset ber-video (mis. #701) dimuat. Profil terpisah dipakai agar flag pasti berlaku
rem walau Chrome biasa sedang terbuka.
cd /d "%~dp0"

rem Mulai server hanya jika port 8000 belum dipakai
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
if errorlevel 1 (
  start "XEDITZ Server" /min python server.py
  timeout /t 3 /nobreak >nul
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

start "" "%CHROME%" --disable-accelerated-video-decode --user-data-dir="%LocalAppData%\XEDITZ-Chrome" --no-first-run http://127.0.0.1:8000/
