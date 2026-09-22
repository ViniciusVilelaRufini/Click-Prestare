const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadControllerWithMocks({ db, saveToAWS }) {
  const controllerPath = path.resolve(__dirname, '../src/controller/ControllerFinanceiro.js');
  const originalLoad = Module._load;

  delete require.cache[controllerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '../database/DB_Financeiro.js') return db;
    if (request === '../utils/saveToAWS') return saveToAWS;
    if (request === 'date-fns/fp') return { formatRelativeWithOptions: () => () => '' };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

test('ControllerFinanceiro.update preserves an existing image URL through the explicit edit path', async () => {
  const calls = { updatePhoto: [], update: [] };
  const db = {
    get: async () => ({ photo: existingUrl }),
    updatePhoto: async (...args) => calls.updatePhoto.push(args),
    update: async (...args) => calls.update.push(args),
  };
  let saveArgs;
  const existingUrl = 'https://legacy.example.test/condominios/1/financeiro/receipt.jpg';
  const controller = loadControllerWithMocks({
    db,
    saveToAWS: async (...args) => {
      saveArgs = args;
      return { url: args[0] };
    },
  });
  const res = { json: () => undefined, status: () => ({ json: () => undefined }) };

  await controller.update(
    {
      body: {
        id_condominio: 1,
        financeiro: { id: 9, photo: existingUrl },
      },
    },
    res,
  );

  assert.equal(saveArgs[0], existingUrl);
  assert.deepEqual(saveArgs[3], { existing: true });
  assert.deepEqual(calls.updatePhoto, [[existingUrl, 9]]);
});

test('ControllerFinanceiro.update rejects a new non-data URL instead of treating it as an existing file', async () => {
  const db = {
    get: async () => ({ photo: 'dev/condominios/1/financeiro/old.jpg' }),
    updatePhoto: async () => assert.fail('must not update the photo'),
    update: async () => assert.fail('must not update the record'),
  };
  const controller = loadControllerWithMocks({
    db,
    saveToAWS: async (...args) => {
      if (!args[3]?.existing) throw new Error('NEW_UPLOAD_MUST_BE_DATA_URL');
      return { url: args[0] };
    },
  });
  let response;
  const res = {
    json: () => undefined,
    status: () => ({ json: (body) => { response = body; } }),
  };

  await controller.update(
    {
      body: {
        id_condominio: 1,
        financeiro: { id: 9, photo: 'https://attacker.example.test/new.jpg' },
      },
    },
    res,
  );

  assert.equal(response.message, 'NEW_UPLOAD_MUST_BE_DATA_URL');
});
