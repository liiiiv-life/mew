/** Deterministic LEFT-facing rig. Coordinates are native 128px; angles are radians. */
export const RIG = Object.freeze({ ground: 110, ankleY: 107, fore: [17, 18], hind: [18, 20], torsoLength: 37 })

const definitions = [
  ['idle', 48, 2400, true], ['walk', 32, 640, true], ['run', 16, 320, true],
  ['jump', 16, 640, true], ['fall', 16, 640, true], ['love', 32, 1280, true], ['struggle', 24, 960, true],
  ['idle-walk', 16, 320, false], ['walk-idle', 21, 420, false], ['idle-run', 20, 400, false],
  ['run-idle', 20, 400, false], ['walk-run', 20, 400, false], ['run-walk', 20, 400, false],
  ['takeoff', 16, 320, false], ['apex', 16, 320, false], ['landing', 20, 400, false],
]
export const MOTIONS = definitions.map(([name, frames, durationMs, loop]) => ({ name, frames, durationMs, loop }))
const byName = Object.fromEntries(MOTIONS.map(motion => [motion.name, motion]))
const ROOT_X = [43, 45, 80, 78]
const NEUTRAL_X = [41, 49, 83, 75]
const GAITS = {
  // The far foreleg centre is inset slightly to keep its maximum stance within its 35px reach.
  walk: { stride: 40.96, duty: 0.65, phase: [0, 0.5, 0.75, 0.25], centres: [41, 47.8, 83, 80.6], lift: 11, flourish: 0 },
  run: { stride: 49.066666667, duty: 0.28, phase: [0, 0.1, 0.5, 0.4], centres: [41, 52.8, 83, 85], lift: 22, flourish: 13 },
}
const SPEED = { idle: 0, walk: 64, run: 49.066666667 / 0.32 }
const TAU = Math.PI * 2
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t) }
const envelope = t => Math.sin(Math.PI * clamp(t)) ** 2
const lerp = (a, b, t) => a + (b - a) * t
const wrap = t => ((t % 1) + 1) % 1

function hermite(a, b, va, vb, t, seconds) {
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * va * seconds + (-2 * t3 + 3 * t2) * b + (t3 - t2) * vb * seconds
}

function neutralPose() {
  return {
    body: { x: 61.5, y: 76, angle: 0, arch: 0 },
    head: { angle: 0, tilt: 0, blink: 0 },
    feet: NEUTRAL_X.map(x => ({ x, y: RIG.ankleY })),
    tailPhase: 0,
    contacts: [true, true, true, true],
  }
}

function gaitFoot(gait, index, phase) {
  const u = wrap(phase - gait.phase[index]), a = gait.stride * gait.duty / 2
  if (u < gait.duty) return { foot: { x: gait.centres[index] - a + gait.stride * u, y: RIG.ankleY }, contact: true }
  const q = (u - gait.duty) / (1 - gait.duty), m = gait.stride * (1 - gait.duty)
  const swingX = a + m * q + (-6 * a - 3 * m) * q * q + (4 * a + 2 * m) * q * q * q
  return {
    foot: { x: gait.centres[index] + swingX + gait.flourish * Math.sin(Math.PI * q) ** 2 * Math.sin(TAU * q), y: RIG.ankleY - gait.lift * Math.sin(Math.PI * q) ** 2 },
    contact: false,
  }
}

function loopPose(name, t) {
  const p = wrap(t), pose = neutralPose(), e = envelope(p)
  pose.tailPhase = 0.065 * Math.sin(TAU * p) + 0.015 * Math.sin(TAU * 2 * p)
  if (name === 'idle') {
    pose.tailPhase *= e
    pose.body.y += 0.65 * e
    pose.head.blink = p > 0.69 && p < 0.77 ? envelope((p - 0.69) / 0.08) : 0
    pose.head.tilt = 0.006 * e
  } else if (name === 'walk' || name === 'run') {
    const gait = GAITS[name]
    const samples = ROOT_X.map((_, index) => gaitFoot(gait, index, p))
    pose.feet = samples.map(sample => sample.foot)
    pose.contacts = samples.map(sample => sample.contact)
    pose.body.y += name === 'walk' ? 0.65 * Math.sin(TAU * p) ** 2 : -1.25 * Math.sin(TAU * p) ** 2
    pose.body.arch = (name === 'walk' ? 0.6 : 2.8) * e
    pose.head.angle = (name === 'walk' ? 0.012 : 0.03) * Math.sin(TAU * p) ** 2
    pose.tailPhase *= name === 'run' ? 1.5 : 0.8
  } else if (name === 'jump') {
    pose.feet = [{ x: 49, y: 94 }, { x: 56.5, y: 92 }, { x: 70, y: 99 }, { x: 62, y: 96 }]
    pose.feet.forEach((foot, i) => { foot.y -= (i < 2 ? 0.8 : 0.6) * e; foot.x += (i % 2 ? -0.5 : 0.5) * e })
    pose.body.arch = 1.8 + 0.5 * e
    pose.head.angle = -0.035 - 0.01 * e
    pose.contacts = [false, false, false, false]
    pose.tailPhase *= 0.6
  } else if (name === 'fall') {
    pose.feet = NEUTRAL_X.map((x, i) => ({ x, y: RIG.ankleY - [0, 1, 3, 4][i] - 0.5 * e }))
    pose.head.angle = 0.025 + 0.008 * e
    pose.body.arch = 0.6 + 0.25 * e
    pose.contacts = [false, false, false, false]
    pose.tailPhase *= 0.5
  } else if (name === 'love') {
    pose.tailPhase *= e
    pose.body.y += 0.45 * e
    pose.head.angle = -0.105 * e
    pose.head.tilt = -0.04 * e
    pose.head.blink = e
    pose.tailPhase += 0.075 * e
  } else if (name === 'struggle') {
    pose.tailPhase *= e
    pose.contacts = [false, false, false, false]
    pose.body.arch = 0.8 * e
    pose.feet.forEach((foot, i) => {
      foot.x += e * 2 * Math.sin(TAU * 2 * p + i * 1.35)
      foot.y -= e * (3 + 2 * Math.sin(TAU * 2 * p + i * 1.6))
    })
    pose.head.angle = 0.015 * e
    pose.tailPhase += 0.08 * Math.sin(TAU * 2 * p) * e
  } else throw new Error(`Unknown loop: ${name}`)
  return pose
}

function loopVelocity(name) {
  const h = 0.00001, seconds = byName[name].durationMs / 1000
  const before = loopPose(name, 1 - h), after = loopPose(name, h)
  const velocity = { body: {}, head: {}, feet: [], tailPhase: (after.tailPhase - before.tailPhase) / (2 * h * seconds) }
  for (const part of ['body', 'head']) for (const key of Object.keys(before[part])) velocity[part][key] = (after[part][key] - before[part][key]) / (2 * h * seconds)
  velocity.feet = before.feet.map((foot, i) => ({ x: (after.feet[i].x - foot.x) / (2 * h * seconds), y: (after.feet[i].y - foot.y) / (2 * h * seconds) }))
  return velocity
}

// Each foot has a world-space support anchor. Local x follows the integrated
// linearly interpolated runtime speed, so support feet remain stationary on screen.
// [release, touchdown] describes one step; null means the boundary is airborne.
const TRANSITIONS = {
  'idle-walk': { from: 'idle', to: 'walk', steps: [[0.15, 1], [0.12, 0.44], [0.38, 0.65], [0.48, null]], lifts: [8, 8, 16, 8], crouch: 0.7 },
  'walk-idle': { from: 'walk', to: 'idle', steps: [[0.62, 0.9], [0.1, 0.6], [0.26, 0.72], [null, 0.35]], crouch: 0.6 },
  'idle-run': { from: 'idle', to: 'run', steps: [[0.28, 1], [0.55, null], [0.66, null], [0.6, null]], lifts: [8, 8, 8, 16], crouch: 2.6 },
  'run-idle': { from: 'run', to: 'idle', steps: [[0.34, 0.74], [null, 0.3], [null, 0.18], [null, 0.28]], lifts: [11, 13, 8, 8], crouch: 2.2 },
  'walk-run': { from: 'walk', to: 'run', steps: [[0.48, 1], [0.18, null], [0.58, null], [null, null]], temporary: { 3: [0.28, 0.7, 76] }, lifts: [8, 8, 0, 12], crouch: 1.6 },
  'run-walk': { from: 'run', to: 'walk', steps: [[0.38, 1], [null, 0.34], [null, 0.55], [null, null]], lifts: [12, 16, 8, 8], crouch: 1.0 },
}

function blendFields(from, to, fromVelocity, toVelocity, p, seconds) {
  const pose = neutralPose()
  for (const part of ['body', 'head']) for (const key of Object.keys(pose[part])) pose[part][key] = hermite(from[part][key], to[part][key], fromVelocity[part][key], toVelocity[part][key], p, seconds)
  pose.tailPhase = hermite(from.tailPhase, to.tailPhase, fromVelocity.tailPhase, toVelocity.tailPhase, p, seconds)
  return pose
}

function swingBetween(start, end, startVelocity, endVelocity, q, seconds, lift) {
  // All planted endpoints have zero world velocity. The quartic lift has zero
  // value and slope at either end, including an airborne boundary pose.
  return {
    x: hermite(start.x, end.x, startVelocity.x, endVelocity.x, q, seconds),
    y: Math.min(RIG.ankleY, hermite(start.y, end.y, startVelocity.y, endVelocity.y, q, seconds) - lift * 16 * q * q * (1 - q) * (1 - q)),
  }
}

function groundedTransition(name, p) {
  const plan = TRANSITIONS[name], seconds = byName[name].durationMs / 1000
  const from = loopPose(plan.from, 0), to = loopPose(plan.to, 0), vf = loopVelocity(plan.from), vt = loopVelocity(plan.to)
  const pose = blendFields(from, to, vf, vt, p, seconds)
  const v0 = SPEED[plan.from], v1 = SPEED[plan.to]
  const distanceAt = u => seconds * (v0 * u + (v1 - v0) * u * u / 2)
  const distance = distanceAt(p), finalDistance = distanceAt(1)
  pose.body.y += plan.crouch * envelope(p)
  pose.contacts = []
  pose.feet = from.feet.map((foot, i) => {
    const sourceWorld = { x: foot.x, y: foot.y }, targetWorld = { x: to.feet[i].x - finalDistance, y: to.feet[i].y }
    const sourceVelocity = { x: vf.feet[i].x - v0, y: vf.feet[i].y }, targetVelocity = { x: vt.feet[i].x - v1, y: vt.feet[i].y }
    const sourceContact = from.contacts[i], targetContact = to.contacts[i]
    const [release, touchdown] = plan.steps[i], zero = { x: 0, y: 0 }
    const temporary = plan.temporary?.[i]
    let world, contact = false
    if (temporary) {
      const [land, leave, localX] = temporary, anchor = { x: localX - distanceAt(land), y: RIG.ankleY }
      if (p < land) world = swingBetween(sourceWorld, anchor, sourceVelocity, zero, p / land, seconds * land, 4)
      else if (p <= leave) { world = anchor; contact = true }
      else world = swingBetween(anchor, targetWorld, zero, targetVelocity, (p - leave) / (1 - leave), seconds * (1 - leave), plan.lifts?.[i] ?? 7)
    } else if (sourceContact && release !== null && p <= release) {
      world = sourceWorld; contact = true
    } else if (targetContact && touchdown !== null && p >= touchdown) {
      world = targetWorld; contact = true
    } else {
      const start = sourceContact && release !== null ? release : 0
      const end = targetContact && touchdown !== null ? touchdown : 1
      world = swingBetween(sourceWorld, targetWorld, sourceContact ? zero : sourceVelocity, targetContact ? zero : targetVelocity, clamp((p - start) / (end - start)), seconds * (end - start), plan.lifts?.[i] ?? (name === 'walk-idle' ? 5 : name === 'run-walk' ? 16 : 8))
    }
    pose.contacts.push(contact)
    return { x: world.x + distance, y: world.y }
  })
  pose.qa = { rootDistance: distance, source: plan.from, target: plan.to }
  return pose
}

function airborneTransition(name, p) {
  const [fromName, toName] = name === 'takeoff' ? ['idle', 'jump'] : name === 'apex' ? ['jump', 'fall'] : ['fall', 'idle']
  const from = loopPose(fromName, 0), to = loopPose(toName, 0), seconds = byName[name].durationMs / 1000
  const pose = blendFields(from, to, loopVelocity(fromName), loopVelocity(toName), p, seconds)
  pose.contacts = []
  if (name === 'takeoff') {
    pose.body.y += 4.2 * envelope(p)
    const release = [0.48, 0.54, 0.8, 0.74]
    pose.feet = from.feet.map((foot, i) => {
      const active = p > release[i], q = active ? (p - release[i]) / (1 - release[i]) : 0
      pose.contacts.push(!active)
      return { x: lerp(foot.x, to.feet[i].x, smooth(q)), y: lerp(foot.y, to.feet[i].y, smooth(q)) }
    })
  } else if (name === 'landing') {
    pose.body.y += 3.4 * envelope(p)
    const touchdown = [0, 0.12, 0.2, 0.26]
    pose.feet = from.feet.map((foot, i) => {
      const q = touchdown[i] ? clamp(p / touchdown[i]) : 1
      pose.contacts.push(p >= touchdown[i])
      return { x: to.feet[i].x, y: lerp(foot.y, to.feet[i].y, smooth(q)) }
    })
  } else {
    pose.body.arch += 0.65 * envelope(p)
    pose.feet = from.feet.map((foot, i) => ({ x: lerp(foot.x, to.feet[i].x, smooth(p)), y: lerp(foot.y, to.feet[i].y, smooth(p)) - 1.8 * envelope(p) }))
    pose.contacts = [false, false, false, false]
  }
  pose.qa = { rootDistance: 0, source: fromName, target: toName }
  return pose
}

export function poseAt(name, t) {
  if (!byName[name]) throw new Error(`Unknown motion: ${name}`)
  const p = clamp(t)
  if (byName[name].loop) {
    const pose = loopPose(name, p)
    pose.qa = { rootDistance: (SPEED[name] ?? 0) * byName[name].durationMs / 1000 * p }
    return pose
  }
  // Boundary poses are returned verbatim so all silhouette fields match exactly.
  if (p === 0 || p === 1) {
    const plan = TRANSITIONS[name]
    const from = plan?.from ?? (name === 'takeoff' ? 'idle' : name === 'apex' ? 'jump' : 'fall')
    const to = plan?.to ?? (name === 'takeoff' ? 'jump' : name === 'apex' ? 'fall' : 'idle')
    const pose = loopPose(p === 0 ? from : to, 0)
    const distance = plan ? byName[name].durationMs / 1000 * (SPEED[from] + SPEED[to]) / 2 * p : 0
    pose.qa = { rootDistance: distance, source: from, target: to }
    return pose
  }
  return TRANSITIONS[name] ? groundedTransition(name, p) : airborneTransition(name, p)
}

export function jointsFor(pose) {
  const { x: cx, y: cy, angle } = pose.body, cosine = Math.cos(angle), sine = Math.sin(angle)
  return ROOT_X.map((x, i) => {
    const dx = x - 61.5, root = { x: cx + dx * cosine, y: cy + dx * sine }
    const ankle = { ...pose.feet[i] }, lengths = i < 2 ? RIG.fore : RIG.hind
    const vx = ankle.x - root.x, vy = ankle.y - root.y, distance = Math.hypot(vx, vy), [a, b] = lengths
    if (distance > a + b + 1e-7 || distance < Math.abs(a - b) - 1e-7) throw new Error(`IK_UNREACHABLE leg=${i} distance=${distance.toFixed(8)} limits=${Math.abs(a - b)}..${a + b}`)
    const along = (a * a - b * b + distance * distance) / (2 * distance)
    const perpendicular = Math.sqrt(Math.max(0, a * a - along * along)), bend = i < 2 ? -1 : 1
    const knee = { x: root.x + along * vx / distance - bend * perpendicular * vy / distance, y: root.y + along * vy / distance + bend * perpendicular * vx / distance }
    return { root, knee, ankle, lengths: [...lengths], near: i % 2 === 0, hind: i > 1 }
  })
}

/** Quantitative QA retains contact intervals instead of inferring contact from pixels. */
export function inspectRig(samplesPerMotion = 1000) {
  const result = { samplesPerMotion: samplesPerMotion + 1, minPawSeparationRequired: 6.5, motions: [], failures: [], maxBoneError: 0, maxTorsoError: 0, maxContactDrift: 0, minPawSeparation: Infinity }
  for (const motion of MOTIONS) {
    const anchors = [null, null, null, null], failures = [], closePaws = [], aerial = []
    let maxBoneError = 0, maxTorsoError = 0, maxContactDrift = 0, minPawSeparation = Infinity
    for (let sample = 0; sample <= samplesPerMotion; sample++) {
      const t = sample / samplesPerMotion, pose = poseAt(motion.name, t)
      try {
        const legs = jointsFor(pose)
        for (const leg of legs) {
          maxBoneError = Math.max(maxBoneError, Math.abs(Math.hypot(leg.knee.x - leg.root.x, leg.knee.y - leg.root.y) - leg.lengths[0]), Math.abs(Math.hypot(leg.ankle.x - leg.knee.x, leg.ankle.y - leg.knee.y) - leg.lengths[1]))
        }
        maxTorsoError = Math.max(maxTorsoError, Math.abs(Math.hypot(legs[0].root.x - legs[2].root.x, legs[0].root.y - legs[2].root.y) - RIG.torsoLength))
      } catch (error) { failures.push({ t, error: error.message }) }
      pose.feet.forEach((foot, i) => {
        if (!pose.contacts[i]) { anchors[i] = null; return }
        const world = { x: foot.x - pose.qa.rootDistance, y: foot.y }
        if (anchors[i]) maxContactDrift = Math.max(maxContactDrift, Math.hypot(world.x - anchors[i].x, world.y - anchors[i].y))
        else anchors[i] = world
      })
      if (!pose.contacts.some(Boolean)) aerial.push(t)
      if (sample < samplesPerMotion) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const separation = Math.hypot(pose.feet[a].x - pose.feet[b].x, pose.feet[a].y - pose.feet[b].y)
        minPawSeparation = Math.min(minPawSeparation, separation)
        if (separation < result.minPawSeparationRequired) closePaws.push({ t, pair: [a, b] })
      }
    }
    result.maxBoneError = Math.max(result.maxBoneError, maxBoneError)
    result.maxTorsoError = Math.max(result.maxTorsoError, maxTorsoError)
    result.maxContactDrift = Math.max(result.maxContactDrift, maxContactDrift)
    result.minPawSeparation = Math.min(result.minPawSeparation, minPawSeparation)
    if (failures.length) result.failures.push({ name: motion.name, count: failures.length, first: failures[0] })
    result.motions.push({ name: motion.name, maxBoneError, maxTorsoError, maxContactDrift, minPawSeparation, closePawSamples: closePaws.length, firstClosePaws: closePaws.slice(0, 4), aerialRatio: aerial.length / (samplesPerMotion + 1), unreachableSamples: failures.length })
  }
  return result
}
