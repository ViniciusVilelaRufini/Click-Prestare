const axios = require('axios');

async function test() {
  try {
    const payload = {
      id_condominio: 7,
      financeiro: {
        nome: "Test API Null Data",
        tipo: "C",
        valor: 100,
        data: null,
        data_vencimento: "2026-05-22",
        categoria: "Condomínio"
      }
    };
    const response = await axios.post('http://localhost:3000/api/financeiro/insert', payload, {
      headers: {
        'Authorization': 'Bearer ' // We don't need a real token if we bypass auth check or use local mock, wait!
      }
    });
    console.log("Response:", response.data);
  } catch (e) {
    console.error("Error status:", e.response?.status);
    console.error("Error data:", e.response?.data);
  }
}

test();
