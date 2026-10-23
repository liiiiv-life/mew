import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDateInput, validDateValue, shiftDate, localToday } from './date-value.ts'

test('direct date entry accepts explicit/short dates and validates real calendar days', () => {
  for (const input of ['2028-2-29', '2028/02/29', '2028.2.29', '20280229']) assert.equal(parseDateInput(input), '2028-02-29')
  assert.equal(parseDateInput('10/15', '2026-01-01'), '2026-10-15')
  assert.equal(parseDateInput('10.15', '2027-12-31'), '2027-10-15')
  assert.equal(parseDateInput('   '), null)
  for (const input of ['2026-02-29', '2026-04-31', '2026-00-15', '2026-13-01', '2026-10-00', '0000-01-01', 'not a date']) assert.equal(parseDateInput(input), undefined)
  assert.equal(validDateValue('2026-2-15'), false)
  assert.equal(validDateValue('0099-12-31'), true)
  assert.equal(validDateValue(20261015), false)
})
test('date arithmetic handles leap/month/year boundaries without local timezone conversion', () => {
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29')
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
  assert.equal(localToday(new Date(2026, 9, 3, 0, 1)), '2026-10-03')
})
