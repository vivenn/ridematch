// registers a handful of online drivers scattered around Connaught Place, Delhi
// so there's something nearby for a test ride request to find
// usage: npm run seed (with the server already running)

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

const drivers = [
  { name: 'Ramesh Kumar', phone: '9810000001', vehicleNo: 'DL01AB1001', lat: 28.6139, lng: 77.209 },
  { name: 'Suresh Yadav', phone: '9810000002', vehicleNo: 'DL01AB1002', lat: 28.6155, lng: 77.2105 },
  { name: 'Vikram Singh', phone: '9810000003', vehicleNo: 'DL01AB1003', lat: 28.611, lng: 77.2085 },
  { name: 'Anil Sharma', phone: '9810000004', vehicleNo: 'DL01AB1004', lat: 28.62, lng: 77.219 },
  { name: 'Deepak Verma', phone: '9810000005', vehicleNo: 'DL01AB1005', lat: 28.63, lng: 77.225 },
  { name: 'Manoj Tiwari', phone: '9810000006', vehicleNo: 'DL01AB1006', lat: 28.605, lng: 77.2 },
];

async function main() {
  for (const driver of drivers) {
    const res = await fetch(`${BASE_URL}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: driver.name, phone: driver.phone, vehicleNo: driver.vehicleNo }),
    });

    if (!res.ok) {
      console.error(`failed to register ${driver.name}: ${res.status} ${await res.text()}`);
      continue;
    }

    const created = await res.json();

    await fetch(`${BASE_URL}/drivers/${created.id}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: driver.lat, lng: driver.lng }),
    });

    await fetch(`${BASE_URL}/drivers/${created.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ONLINE' }),
    });

    console.log(`${driver.name.padEnd(15)} ${created.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
