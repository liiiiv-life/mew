// 디버깅 연습용: 기본 모드에는 평균 계산 오류가 하나 있습니다.
// --fixed를 붙이면 정상 결과와 비교할 수 있습니다.
const useCorrectAverage = process.argv.includes('--fixed')
const passScore = 80
const students = [
  { name: '민수', scores: [85, 90, 95] },
  { name: '지연', scores: [60, 70, 80] },
  { name: '서준', scores: [95, 100, 90] },
]

function calculateAverage(scores) {
  let total = 0
  for (let index = 0; index < scores.length; index++) {
    const score = scores[index]
    total += score
  }

  const count = useCorrectAverage ? scores.length : scores.length + 1
  const average = total / count
  return average
}

function analyzeStudents(studentList) {
  const report = []
  let passedCount = 0

  for (const student of studentList) {
    const average = calculateAverage(student.scores)
    const passed = average >= passScore
    if (passed) {
      passedCount++
    }
    report.push({ name: student.name, average, passed })
  }

  return { report, passedCount }
}

const result = analyzeStudents(students)
console.log(useCorrectAverage ? '정상 계산 모드' : '디버깅 연습 모드 (평균 계산 오류 포함)')
for (const student of result.report) {
  console.log(`${student.name}: 평균 ${student.average.toFixed(2)}점 / ${student.passed ? '통과' : '미통과'}`)
}
console.log(`통과 인원: ${result.passedCount} / ${students.length}`)
