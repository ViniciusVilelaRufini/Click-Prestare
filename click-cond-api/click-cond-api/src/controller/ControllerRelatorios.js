const service = require('../services/RelatoriosService');

module.exports = {
  /**
   * GET /condominios/:id/relatorios?tipo=&formato=&dataInicio=&dataFim=
   * Devolve o arquivo (PDF/XLSX) como download.
   */
  async download(req, res) {
    try {
      const idCondominio = Number(req.params.id);
      const { tipo, formato, dataInicio, dataFim } = req.query;

      if (!['visitantes', 'encomendas', 'ocorrencias', 'financeiro'].includes(tipo)) {
        return res.status(400).json({ message: 'Tipo de relatório inválido.' });
      }
      const fmt = formato === 'xlsx' ? 'xlsx' : 'pdf';

      const { buffer, mime, filename } = await service.generate(
        idCondominio,
        tipo,
        fmt,
        dataInicio,
        dataFim,
      );

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.end(buffer);
    } catch (err) {
      console.error('[Relatorios] erro:', err.message);
      return res.status(500).json({ message: 'Não foi possível gerar o relatório.' });
    }
  },
};
