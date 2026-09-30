// Alamat IP laptop ini di jaringan WiFi/LAN — dipakai jalankan-lokal-wifi.bat
// supaya HP/laptop lain di WiFi yang sama bisa membuka dashboard dan menu.
// Mencetak satu alamat (mis. 192.168.18.13); keluar dengan kode 1 kalau
// laptop tidak tersambung ke jaringan mana pun.
const os = require('node:os');

// Adaptor virtual (VirtualBox, Hyper-V/WSL, VMware, dll) tidak bisa dijangkau
// perangkat lain. 192.168.56.x = jaringan host-only bawaan VirtualBox, yang
// di Windows namanya cuma "Ethernet 2" dan sejenisnya.
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier/i;
const PRIVAT = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

const kandidat = [];
for (const [nama, alamat] of Object.entries(os.networkInterfaces())) {
  if (VIRTUAL.test(nama)) continue;
  for (const a of alamat ?? []) {
    if (a.family !== 'IPv4' || a.internal || !PRIVAT.test(a.address) || a.address.startsWith('192.168.56.')) continue;
    kandidat.push({ ip: a.address, wifi: /wi-?fi|wlan|wireless/i.test(nama) });
  }
}
// WiFi lebih dulu; kabel LAN kalau laptop memang tersambung pakai kabel.
kandidat.sort((x, y) => Number(y.wifi) - Number(x.wifi));
if (kandidat.length === 0) {
  process.exitCode = 1;
} else {
  console.log(kandidat[0].ip);
}
