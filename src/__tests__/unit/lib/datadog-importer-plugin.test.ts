import {DatadogImporter} from '../../../lib';
import {v1} from '@datadog/datadog-api-client';
import {ApiException} from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common';
import {ERRORS} from '@grnsft/if-core/utils';

const {ConfigError} = ERRORS;

console.log = jest.fn();
console.warn = jest.fn();
console.error = jest.fn();
console.debug = jest.fn();

jest.mock('@datadog/datadog-api-client', () => ({
  client: {
    createConfiguration: jest.fn(),
  },
  v1: {
    MetricsApi: jest.fn().mockImplementation(() => {
      return {
        queryMetrics: jest.fn(),
      };
    }),
  },
}));

describe('DatadogImporter(): ', () => {
  const createMockApiInstance = (seriesData: any) => ({
    queryMetrics: jest.fn(() => {
      if (seriesData) {
        return Promise.resolve({series: seriesData});
      }
      return Promise.resolve({});
    }),
  });

  const createMockApiInstanceWithError = () => ({
    queryMetrics: jest.fn(() => {
      throw new ApiException(400, {errors: ['Bad Request']});
    }),
  });

  const validConfig = {
    'raw-query': 'avg:system.cpu.user{instance-id:<instance-id>}',
    'output-metric-name': 'cpu-usage',
    'aggregation-tags': 'instance-type,region',
    'aggregation-tag-output-names': 'instance-type-output,region-output',
  };

  const minimalConfig = {
    'raw-query': 'avg:system.cpu.user{*}',
    'output-metric-name': 'cpu-usage',
  };

  const validInput = [
    {
      'instance-id': 'i-123456',
      'instance-type': 't3.micro',
      region: 'us-east-1',
      timestamp: '2024-06-10T05:00:00.000Z',
      duration: 20,
    },
  ];

  describe('execute(): ', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('has metadata field.', () => {
      const pluginInstance = DatadogImporter({}, {}, {});

      expect.assertions(3);
      expect(pluginInstance).toHaveProperty('metadata');
      expect(pluginInstance).toHaveProperty('execute');
      expect(typeof pluginInstance.execute).toBe('function');
    });

    it('should throw config exception if raw-query is not provided', async () => {
      const invalidConfig = {
        'output-metric-name': 'cpu-usage',
      };
      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('raw-query is required.')
      );
    });

    it('should throw config exception if output-metric-name is not provided', async () => {
      const invalidConfig = {
        'raw-query': 'avg:system.cpu.user{*}',
      };
      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('output-metric-name is required.')
      );
    });

    it('should throw config exception if aggregation-tags and aggregation-tag-output-names length are not equal', async () => {
      const invalidConfig = {
        ...validConfig,
        'aggregation-tag-output-names': 'instance-type-output',
      };
      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError(
          'aggregation-tags and aggregation-tag-output-names length must be equal.'
        )
      );
    });

    it('should throw config exception if aggregation-tag-output-names contains duplicate values', async () => {
      const invalidConfig = {
        ...validConfig,
        'aggregation-tag-output-names':
          'instance-type-output,instance-type-output',
      };
      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError(
          'aggregation-tag-output-names contains duplicate values.'
        )
      );
    });

    it('should process raw query with placeholders and return transformed data', async () => {
      const seriesData = [
        {
          tagSet: [
            'instance-id:i-123456',
            'instance-type:t3.micro',
            'region:us-east-1',
          ],
          pointlist: [
            [1717995600000, 1],
            [1717995610000, 0.7],
          ],
        },
      ];

      const apiInstance = createMockApiInstance(seriesData);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(validConfig, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toEqual([
        {
          'instance-id': 'i-123456',
          'instance-type': 't3.micro',
          region: 'us-east-1',
          timestamp: '2024-06-10T05:00:00.000Z',
          duration: 10,
          'instance-type-output': 't3.micro',
          'region-output': 'us-east-1',
          'cpu-usage': 1,
        },
        {
          'instance-id': 'i-123456',
          'instance-type': 't3.micro',
          region: 'us-east-1',
          timestamp: '2024-06-10T05:00:10.000Z',
          duration: 10,
          'instance-type-output': 't3.micro',
          'region-output': 'us-east-1',
          'cpu-usage': 0.7,
        },
      ]);
    });

    it('should process raw query without aggregation tags', async () => {
      const seriesData = [
        {
          tagSet: ['instance-id:i-123456'],
          pointlist: [[1717995600000, 0.85]],
        },
      ];

      const apiInstance = createMockApiInstance(seriesData);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(minimalConfig, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toEqual([
        {
          'instance-id': 'i-123456',
          'instance-type': 't3.micro',
          region: 'us-east-1',
          timestamp: '2024-06-10T05:00:00.000Z',
          duration: 20,
          'cpu-usage': 0.85,
        },
      ]);
    });

    it('should handle API errors gracefully', async () => {
      const apiInstance = createMockApiInstanceWithError();
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(validConfig, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle empty series data', async () => {
      const apiInstance = createMockApiInstance([]);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(validConfig, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toEqual([]);
      expect(console.log).toHaveBeenCalledWith('Series not found');
    });

    it('should warn when placeholder is not found in input or config', async () => {
      const configWithMissingPlaceholder = {
        'raw-query': 'avg:system.cpu.user{instance-id:<missing-placeholder>}',
        'output-metric-name': 'cpu-usage',
      };

      const seriesData = [
        {
          tagSet: ['instance-id:i-123456'],
          pointlist: [[1717995600000, 0.5]],
        },
      ];

      const apiInstance = createMockApiInstance(seriesData);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(configWithMissingPlaceholder, {}, {});
      await importer.execute(validInput);

      expect(console.warn).toHaveBeenCalledWith(
        'Placeholder "missing-placeholder" not found in input values nor config values'
      );
    });

    it('should use config values for placeholders when not found in input', async () => {
      const configWithPlaceholder = {
        'raw-query':
          'avg:system.cpu.user{instance-id:<instance-id>,env:<environment>}',
        'output-metric-name': 'cpu-usage',
        environment: 'production',
      };

      const seriesData = [
        {
          tagSet: ['instance-id:i-123456', 'env:production'],
          pointlist: [[1717995600000, 0.5]],
        },
      ];

      const apiInstance = createMockApiInstance(seriesData);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(configWithPlaceholder, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toHaveLength(1);
      expect(result[0]['cpu-usage']).toBe(0.5);
    });
  });
});
