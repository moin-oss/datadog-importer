import {DatadogImporter} from '../../../lib/datadog-importer';

describe('lib/my-custom-plugin: ', () => {
  describe('DatadogImporter(): ', () => {
    it('has metadata field.', () => {
      const pluginInstance = DatadogImporter({});

      expect(pluginInstance).toHaveProperty('metadata');
      expect(pluginInstance).toHaveProperty('execute');
      expect(pluginInstance.metadata).toHaveProperty('kind');
      expect(typeof pluginInstance.execute).toBe('function');
    });

    describe('execute(): ', () => {
      it.skip('applies logic on provided inputs array.', async () => {
        const pluginInstance = DatadogImporter({});
        const inputs = [{}];

        const response = await pluginInstance.execute(inputs, {});
        expect(response).toEqual(inputs);
      });
    });
  });
});
