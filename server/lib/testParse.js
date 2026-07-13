const fs = require('fs');
const { parseScheduleBuffer } = require('./parseSchedule');
(async () => {
  const buf = fs.readFileSync('/home/user/workspace/uploaded_attachments/637416801dc842a48c71c66b17205dfb/20.04.2026-24.04.2026-sedmichen-2.xlsx');
  const data = await parseScheduleBuffer(buf);
  console.log('TITLE:', data.title);
  console.log('PERIOD:', data.period);
  console.log('\nBUS LINES:');
  for (const l of data.lines) console.log(`  ${l.name}  ${l.color}  (${l.locations.length} locs)`);
  console.log('\nSECTIONS:');
  for (const s of data.sections) {
    console.log(`  ${s.name}: total=${s.total}  shifts=[${s.shifts.map(x=>x.count).join(', ')}]`);
    // sample first 3 workers of shift1 with colors
    s.shifts[0].workers.slice(0,3).forEach(w => console.log(`     S1: ${w.num} ${w.name} | ${w.location} | ${w.line} ${w.color}`));
  }
  // Salim Kuytov check
  const all = [];
  data.sections.forEach(s=>s.shifts.forEach(sh=>sh.workers.forEach(w=>all.push(w))));
  const salim = all.find(w=>/куйтов/i.test(w.name));
  console.log('\nSALIM:', salim);
  fs.writeFileSync('/home/user/workspace/septona-signage/data/schedule.json', JSON.stringify(data, null, 2));
  console.log('\nWrote data/schedule.json, total workers:', all.length);
})();
