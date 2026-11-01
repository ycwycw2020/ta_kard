// Real transactions against the configured three-node test chain. Never run as a unit test.
// Service wallets only; no user asset is transferred or modified.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JsonRpcProvider, Wallet, NonceManager, Contract, Interface, AbiCoder, keccak256, randomBytes, hexlify, ZeroHash} from 'ethers';
import {decodeBattleState, BATTLE_EVENTS} from '../lib/battle-chain.mjs';
import {E, catalog} from '../lib/game.mjs';
import {encodeBattleAction} from '../web/battle-protocol.mjs';

const config = JSON.parse(fs.readFileSync(process.env.TALOS_CONFIG_PATH || 'D:/card_endfiled/game/deployment/private/config.json', 'utf8'));
const artifact = name => {
  const local = `build/${name}.json`;
  const path = fs.existsSync(local) ? local : `D:/card_endfiled/game/deployment/build/${name}.json`;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
};
const provider = new JsonRpcProvider(config.rpc, config.chainId, {staticNetwork: true});
provider.pollingInterval = 300;
const rpcProviders = [provider];
const admin = new NonceManager(new Wallet(config.wallets.admin.privateKey, provider));
const seeder = new NonceManager(new Wallet(config.wallets.seeder.privateKey, provider));
const actors = [admin, seeder];
const addresses = await Promise.all(actors.map(x => x.getAddress()));
assert.notEqual(addresses[0].toLowerCase(), addresses[1].toLowerCase(), 'Two distinct service wallets required');
const battle = new Contract(config.battleContract, artifact('TalosBattle').abi, provider);
const items = new Contract(config.itemsContract, artifact('TalosCardItems').abi, provider);
const cards = new Contract(config.contract, artifact('TalosCards').abi, provider);
const events = new Interface(BATTLE_EVENTS);
const stateParam = battle.interface.getFunction('getMatch').outputs[1];
const output = process.env.TALOS_BATTLE_EVIDENCE || 'test/battle-contract-verification.json';
const report = {startedAt: new Date().toISOString(), passed: false, chainId: config.chainId, battleContract: config.battleContract, itemsContract: config.itemsContract, serviceWallets: addresses, checks: [], transactions: [], matches: {}, damageChecks: [], rpcAgreement: null};
const json = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const save = () => fs.writeFileSync(output, json(report));
const opts = {gasPrice: 0, gasLimit: 25000000};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const id = () => hexlify(randomBytes(32));
const safeError = e => String(e.reason || e.shortMessage || e.message || e).slice(0, 350);
function check(text) {report.checks.push(text); save(); console.log('PASS ' + text);}
function unwrap(value, p) {
  if (p.baseType === 'array') return Array.from(value, x => unwrap(x, p.arrayChildren));
  if (p.baseType === 'tuple') return Object.fromEntries(p.components.map((c, i) => [c.name, unwrap(value[i], c)]));
  return value;
}
async function load(matchId, blockTag) {
  blockTag ??= Number(BigInt(await provider.send('eth_blockNumber', [])));
  const m = await battle.getMatch(matchId, {blockTag});
  const raw = unwrap(m.state, stateParam);
  const calculated = keccak256(AbiCoder.defaultAbiCoder().encode([stateParam], [raw]));
  assert.equal(calculated, await battle.stateHash(matchId, {blockTag}), 'ABI-encoded state hash agrees');
  return {info: m.info, raw, state: decodeBattleState(raw, m.tokenIds, m.artworkIds), tokens: Array.from(m.tokenIds), blockTag, stateHash: calculated};
}
async function expectRevert(label, fn) {
  let rejected = false;
  try {await fn();} catch (e) {
    // A timeout or transport failure is not evidence of a contract permission check.
    if (e.code !== 'CALL_EXCEPTION') throw e;
    rejected = true;
  }
  assert.equal(rejected, true, label); check(label);
}
async function transaction(label, fn, extra = {}) {
  const tx = await fn(), receipt = await tx.wait();
  assert.equal(receipt.status, 1, label);
  const entry = {label, hash: tx.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), ...extra};
  report.transactions.push(entry);
  for (const log of receipt.logs) {
    let event; try {event = events.parseLog(log);} catch {}
    if (event?.name !== 'BattleDamage') continue;
    const a = event.args, base = Number(a.baseDamage), bonus = Number(a.bonusDamage), shield = Number(a.shieldAbsorbed), hp = Number(a.hpBefore);
    const calculated = Math.min(hp, Math.max(0, (a.barrierBlocked ? 0 : base + bonus) - shield));
    assert.equal(Number(a.finalDamage), calculated, 'Damage event arithmetic');
    report.damageChecks.push({transaction: tx.hash, seq: Number(a.seq), action: Number(a.action), base, bonus, barrierBlocked: a.barrierBlocked, shieldAbsorbed: shield, hpBefore: hp, finalDamage: calculated});
  }
  save(); return receipt;
}
async function inventory(address) {
  const count = Number(await items.balanceOf(address)), found = [];
  for (let offset = 0; offset < count; offset += 64) found.push(...await items.itemsOf(address, offset, 64));
  return found;
}
function chooseTeam(owned, preferred) {
  const byRole = new Map();
  for (const x of owned) {const role = Number(x.artworkId / 100n); if (catalog.some(c => c.id === role) && !byRole.has(role)) byRole.set(role, x.tokenId);}
  let roles = preferred.filter(x => byRole.has(x));
  if (roles.length !== 4 || roles.reduce((n, r) => n + catalog.find(c => c.id === r).cost, 0) > 16)
    roles = [...byRole.keys()].sort((a, b) => catalog.find(c => c.id === a).cost - catalog.find(c => c.id === b).cost).slice(0, 4);
  if (roles.length !== 4 || roles.reduce((n, r) => n + catalog.find(c => c.id === r).cost, 0) > 16) return null;
  return {roles, tokens: roles.map(r => byRole.get(r)), totalCost: roles.reduce((n, r) => n + catalog.find(c => c.id === r).cost, 0)};
}
async function serviceTeam(index, preferred) {
  let selected = chooseTeam(await inventory(addresses[index]), preferred);
  if (!selected) {
    const c = cards.connect(actors[index]);
    if (!await cards.starterClaimed(addresses[index])) await transaction(`service-${index}-claim-starter`, () => c.claimStarter(opts));
    const artIds = Array.from({length: 32}, (_, i) => (i + 1) * 100 + 1);
    await transaction(`service-${index}-materialize-own-receipts`, () => items.connect(actors[index]).materializeFor(addresses[index], artIds, 64, opts));
    selected = chooseTeam(await inventory(addresses[index]), preferred);
  }
  assert.ok(selected, 'Service wallet has four different owned character NFTs within cost 16');
  for (const token of selected.tokens) assert.equal((await items.ownerOf(token)).toLowerCase(), addresses[index].toLowerCase());
  return selected;
}
function choose(state) {
  for (let side = 0; side < 2; side++) {
    if (state.acks[side]) continue;
    const units = side ? state.enemy : state.own;
    const actor = units.findIndex(u => u.ready && u.hp > 0 && u.frozen !== state.round);
    if (actor >= 0) return {side, type: 'combo', actor, target: 0, ally: actor, hand: 0};
  }
  if (state.roundPending) return {side: state.acks[0] ? 1 : 0, type: 'round', actor: 0, target: 0, ally: 0, hand: 0};
  const side = state.priority; assert.ok(side === 0 || side === 1, 'A player has priority');
  const units = side ? state.enemy : state.own, deck = state.decks[side];
  if (state.actions[side] === 3 && !deck.cycled) {
    const hand = deck.hand.findIndex(c => !units.some(u => u.id === c.id && u.hp > 0));
    if (hand >= 0) return {side, type: 'cycle', actor: 0, target: 0, ally: 0, hand};
  }
  const a = E.chooseAI(state, side);
  return {side, type: a.type, actor: a.i ?? 0, target: Math.max(0, a.target ?? 0), ally: Math.max(0, a.ally ?? a.i ?? 0), hand: 0};
}
async function assertUnchanged(matchId, before) {
  const after = await load(matchId); assert.equal(after.raw.seq, before.raw.seq); assert.equal(after.stateHash, before.stateHash);
}

save();
try {
  assert.equal(Number((await provider.getNetwork()).chainId), Number(config.chainId));
  assert.notEqual(await provider.getCode(config.battleContract), '0x');
  assert.equal((await battle.aiOperator()).toLowerCase(), addresses[0].toLowerCase(), 'Configured admin is AI operator');
  for (const address of addresses) assert.equal(await battle.activeMatch(address), ZeroHash, 'Do not modify any pre-existing active service match');
  const teams = [await serviceTeam(0, [1, 2, 3, 6]), await serviceTeam(1, [2, 4, 5, 7])];
  report.teams = teams; save(); check('Only existing service-wallet NFTs or their own starter receipts are used; no transfers');
  const waiting = id(); report.matches.waiting = {id: waiting}; save();
  await transaction('create-waiting-room', () => battle.connect(admin).createMatch(waiting, teams[0].tokens, 2, false, opts));
  await expectRevert('Non-host cannot cancel waiting room', () => battle.connect(seeder).cancelMatch.staticCall(waiting));
  await transaction('cancel-own-waiting-room', () => battle.connect(admin).cancelMatch(waiting, opts));
  assert.equal(await battle.activeMatch(addresses[0]), ZeroHash); check('Host cancellation clears active match');

  const pvp = id(); report.matches.pvp = {id: pvp, steps: []}; save();
  await transaction('pvp-create', () => battle.connect(admin).createMatch(pvp, teams[0].tokens, 2, false, opts));
  await transaction('pvp-join', () => battle.connect(seeder).joinMatch(pvp, teams[1].tokens, 2, opts));
  let m = await load(pvp);
  assert.equal(m.info.started, true); assert.equal(m.info.playerB.toLowerCase(), addresses[1].toLowerCase());
  const outsider = Wallet.createRandom().connect(provider);
  await expectRevert('Nonparticipant action rejected', () => battle.connect(outsider).act.staticCall(pvp, m.raw.seq, 5, 0, 0, 0, 0));
  await expectRevert('Stale sequence rejected', () => battle.connect(admin).act.staticCall(pvp, Number(m.raw.seq) + 1, 5, 0, 0, 0, 0));
  await expectRevert('Invalid input kind rejected', () => battle.connect(actors[m.state.priority]).act.staticCall(pvp, m.raw.seq, 255, 0, 0, 0, 0));
  await expectRevert('AI operator cannot actAI in PvP', () => battle.connect(admin).actAI.staticCall(pvp, m.raw.seq, 5, 0, 0, 0, 0));
  await assertUnchanged(pvp, m); check('Rejected inputs leave sequence and state hash unchanged');
  let repeatAckChecked = false;
  while (m.state.winner === null) {
    assert.ok(report.matches.pvp.steps.length < 500, 'Complete game must terminate');
    const a = choose(m.state), encoded = encodeBattleAction({...a, expectedSeq: m.state.seq});
    if (a.type === 'round' && !repeatAckChecked) {
      const receipt = await transaction('pvp-round', () => battle.connect(actors[a.side]).act(pvp, ...encoded, opts), {matchId: pvp, side: a.side, type: a.type, seq: m.state.seq + 1});
      report.matches.pvp.steps.push({seq: m.state.seq + 1, round: m.state.round, ...a, transaction: receipt.hash});
      const n = await load(pvp); assert.equal(n.raw.seq, m.raw.seq + 1n); m = n;
      if (m.state.roundPending && m.state.acks[a.side]) {
        await expectRevert('Repeated end-round acknowledgement rejected', () => battle.connect(actors[a.side]).act.staticCall(pvp, m.raw.seq, 8, 0, 0, 0, 0));
        await assertUnchanged(pvp, m); repeatAckChecked = true;
      }
    } else {
      const receipt = await transaction(`pvp-${a.type}`, () => battle.connect(actors[a.side]).act(pvp, ...encoded, opts), {matchId: pvp, side: a.side, type: a.type, seq: m.state.seq + 1});
      report.matches.pvp.steps.push({seq: m.state.seq + 1, round: m.state.round, ...a, transaction: receipt.hash});
      const n = await load(pvp); assert.equal(n.raw.seq, m.raw.seq + 1n); m = n;
    }
    if (report.matches.pvp.steps.length % 10 === 0) console.log(`PvP ${report.matches.pvp.steps.length} actions confirmed; round ${m.state.round}; seq ${m.state.seq}`);
    save();
  }
  assert.ok(repeatAckChecked); assert.ok(Number(m.info.finishedAt) > 0);
  for (const address of addresses) assert.equal(await battle.activeMatch(address), ZeroHash);
  report.matches.pvp.final = {round: m.state.round, winner: m.state.winner, finishedAt: Number(m.info.finishedAt), seq: m.state.seq, stateHash: m.stateHash, blockNumber: m.blockTag};
  check('Complete real PvP outcome and active-match cleanup come from contract');
  assert.ok(m.state.round >= 10 && m.state.round < 20, 'Full-game round target: 10 through 19');
  check('Complete real PvP finishes within 10–19 rounds');

  const ai = id(); report.matches.ai = {id: ai}; save();
  await transaction('ai-create', () => battle.connect(admin).createMatch(ai, teams[0].tokens, 2, true, opts));
  let bot = await load(ai);
  await expectRevert('Non-operator actAI rejected', () => battle.connect(seeder).actAI.staticCall(ai, bot.raw.seq, 5, 0, 0, 0, 0));
  await assertUnchanged(ai, bot);
  if (bot.state.priority === 0) {
    await transaction('ai-human-pass', () => battle.connect(admin).act(ai, bot.raw.seq, 5, 0, 0, 0, 0, opts));
    bot = await load(ai);
  }
  const move = choose(bot.state); assert.equal(move.side, 1);
  await transaction('ai-operator-valid-input', () => battle.connect(admin).actAI(ai, ...encodeBattleAction({...move, expectedSeq: bot.state.seq}), opts));
  bot = await load(ai);
  await transaction('ai-human-surrender-cleanup', () => battle.connect(admin).act(ai, bot.raw.seq, 9, 0, 0, 0, 0, opts));
  bot = await load(ai); assert.equal(bot.state.winner, 1); assert.equal(await battle.activeMatch(addresses[0]), ZeroHash);
  report.matches.ai.final = {seq: bot.state.seq, stateHash: bot.stateHash, winner: bot.state.winner};
  check('Only immutable operator submits AI input; contract computes outcome');

  const endpoints = [...new Set([config.rpc, ...(config.nodeRPCs || [])])];
  assert.ok(endpoints.length >= 3, 'Three configured RPC endpoints required');
  for (const url of endpoints.slice(1, 3)) {const p = new JsonRpcProvider(url, config.chainId, {staticNetwork: true}); p.pollingInterval = 300; rpcProviders.push(p);}
  const targetBlock = Math.max(...report.transactions.map(t => t.blockNumber));
  let heights;
  for (let tries = 0; tries < 90; tries++) {
    heights = await Promise.all(rpcProviders.map(async p => Number(BigInt(await p.send('eth_blockNumber', [])))));
    if (Math.min(...heights) >= targetBlock) break;
    await sleep(2000);
  }
  assert.ok(Math.min(...heights) >= targetBlock, 'All three nodes reach last test transaction');
  const commonBlock = Math.min(...heights);
  const replicas = await Promise.all(rpcProviders.map(async (p, i) => {
    const c = battle.connect(p), [block, network, hash, state] = await Promise.all([p.getBlock(commonBlock), p.getNetwork(), c.stateHash(pvp, {blockTag: commonBlock}), c.getMatch(pvp, {blockTag: commonBlock})]);
    return {node: i + 1, chainId: Number(network.chainId), blockNumber: commonBlock, blockHash: block.hash, stateHash: hash, seq: Number(state.state.seq), winner: Number(state.state.winner)};
  }));
  for (const r of replicas) assert.deepEqual({...r, node: 0}, {...replicas[0], node: 0});
  report.rpcAgreement = replicas; check('Three nodes agree on block hash, state hash, sequence and winner at one common block');
  const pvpTx = report.transactions.filter(t => t.label.startsWith('pvp-'));
  report.matches.pvp.gas = {transactions: pvpTx.length, actionTransactions: report.matches.pvp.steps.length, total: pvpTx.reduce((s, t) => s + BigInt(t.gasUsed), 0n).toString(), max: pvpTx.reduce((s, t) => BigInt(t.gasUsed) > s ? BigInt(t.gasUsed) : s, 0n).toString()};
  report.gas = {transactions: report.transactions.length, total: report.transactions.reduce((s, t) => s + BigInt(t.gasUsed), 0n).toString(), max: report.transactions.reduce((s, t) => BigInt(t.gasUsed) > s ? BigInt(t.gasUsed) : s, 0n).toString(), damageEventsChecked: report.damageChecks.length};
  report.passed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(`PASS all real-contract checks; PvP round ${report.matches.pvp.final.round}; ${report.transactions.length} transactions; evidence ${output}`);
} catch (e) {
  report.error = {code: e.code || 'ASSERTION', message: safeError(e)}; report.finishedAt = new Date().toISOString(); save();
  console.error(`FAIL ${safeError(e)}; evidence ${output}`); process.exitCode = 1;
} finally {for (const p of rpcProviders) p.destroy();}
