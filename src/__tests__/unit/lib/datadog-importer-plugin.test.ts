import {DatadogImporter} from '../../../lib';
import {v1} from '@datadog/datadog-api-client';
import {ApiException} from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common';
import {ERRORS} from '@grnsft/if-core/utils';

const {ConfigError} = ERRORS;

console.log = jest.fn();
console.warn = jest.fn();
console.error = jest.fn();

jest.mock('@datadog/datadog-api-client', () => ({
  client: {
    createConfiguration: jest.fn(),
  },
  v1: {
    MetricsApi: jest.fn().mockImplementation(() => {
      return {
        queryMetrics: jest.fn(),
        getMetricMetadata: jest.fn(),
      };
    }),
  },
}));

describe('DatadogImporter(): ', () => {
  const createMockApiInstance = (
    metricToSeriesDataMap: Map<string, any> | null
  ) => ({
    queryMetrics: jest.fn(params => {
      if (metricToSeriesDataMap) {
        for (const [key, value] of metricToSeriesDataMap) {
          if (params.query.includes(key)) {
            return Promise.resolve({series: value});
          }
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
    getMetricMetadata: jest.fn().mockResolvedValue({}),
  });

  const config = {
    'instance-id-tag': 'app',
    metrics: 'metric1,metric2',
    'output-metric-names': 'outputMetric1,outputMetric2',
    tags: 'tag1,tag2',
    'output-tag-names': 'outputTag1,outputTag2',
  };

  const validInput = [
    {
      'instance-id': 'i-123456',
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

    it('should throw config exception if output-metric-names contains duplicate values', async () => {
      const invalidConfig = {
        ...config,
        'output-metric-names': 'outputMetric1,outputMetric1',
      };
      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('Output-metric-names contains duplicate values.')
      );
    });

    it('should throw config exception if metrics and output-metric-names length are not equal', async () => {
      const invalidConfig = {
        ...config,
        'output-metric-names': 'outputMetric1',
      };
      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('Metrics and output-metric-names length must be equal.')
      );
    });

    it('should throw config exception if a metric does not exist', async () => {
      const createMockApiInstance = () => ({
        getMetricMetadata: jest
          .fn()
          .mockRejectedValue(new ApiException(404, {errors: ['Not Found']})),
      });

      const apiInstance = createMockApiInstance();
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(config, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('Metric metric1 does not exist')
      );
    });

    it('should throw config exception if output-tag-names contains duplicate values', async () => {
      const invalidConfig = {
        ...config,
        'output-tag-names': 'outputTag1,outputTag1',
      };

      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('Output-tag-names contains duplicate values.')
      );
    });

    it('should throw config exception if tags and output-tag-names length are not equal', async () => {
      const invalidConfig = {
        ...config,
        'output-tag-names': 'outputTag1',
      };

      const importer = DatadogImporter(invalidConfig, {}, {});
      await expect(importer.execute(validInput)).rejects.toEqual(
        new ConfigError('Tags and output-tag-names length must be equal.')
      );
    });

    it('should collect multiple metrics and return transformed data', async () => {
      const metricToSeriesDataMap: Map<string, any> = new Map();

      const seriesDataMetric1 = [
        {
          tagSet: ['instance-id:i-123456', 'tag1:tag1value', 'tag2:tag2value'],
          pointlist: [
            [1717995600000, 1],
            [1717995610000, 0.7],
          ],
        },
      ];

      const seriesDataMetric2 = [
        {
          tagSet: ['instance-id:i-123456', 'tag1:tag1value', 'tag2:tag2value'],
          pointlist: [
            [1717995600000, 0.25],
            [1717995610000, 0.14],
          ],
        },
      ];

      metricToSeriesDataMap.set('metric1', seriesDataMetric1);
      metricToSeriesDataMap.set('metric2', seriesDataMetric2);

      const apiInstance = createMockApiInstance(metricToSeriesDataMap);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(config, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toEqual([
        {
          'instance-id': 'i-123456',
          timestamp: '2024-06-10T05:00:00.000Z',
          duration: 10,
          outputTag1: 'tag1value',
          outputTag2: 'tag2value',
          outputMetric1: 1,
          outputMetric2: 0.25,
        },
        {
          'instance-id': 'i-123456',
          timestamp: '2024-06-10T05:00:10.000Z',
          duration: 10,
          outputTag1: 'tag1value',
          outputTag2: 'tag2value',
          outputMetric1: 0.7,
          outputMetric2: 0.14,
        },
      ]);
    });

    it('should collect mulitiple sets of tag values and return transformed data', async () => {
      const metricToSeriesDataMap: Map<string, any> = new Map();
      metricToSeriesDataMap.set('metric1', [
        {
          tagSet: [
            'instance-id:i-123456',
            'tag1:tag1value1',
            'tag2:tag2value1',
          ],
          pointlist: [
            [1717995600000, 1],
            [1717995610000, 0.7],
          ],
        },
        {
          tagSet: [
            'instance-id:i-123456',
            'tag1:tag1value2',
            'tag2:tag2value2',
          ],
          pointlist: [
            [1717995600000, 0.25],
            [1717995610000, 0.14],
          ],
        },
      ]);

      const apiInstance = createMockApiInstance(metricToSeriesDataMap);
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(config, {}, {});
      const result = await importer.execute(validInput);

      expect(result).toEqual([
        {
          'instance-id': 'i-123456',
          timestamp: '2024-06-10T05:00:00.000Z',
          duration: 10,
          outputTag1: 'tag1value1',
          outputTag2: 'tag2value1',
          outputMetric1: 1,
        },
        {
          'instance-id': 'i-123456',
          timestamp: '2024-06-10T05:00:10.000Z',
          duration: 10,
          outputTag1: 'tag1value1',
          outputTag2: 'tag2value1',
          outputMetric1: 0.7,
        },
        // Back to the start time, with the new set of tag values
        {
          'instance-id': 'i-123456',
          timestamp: '2024-06-10T05:00:00.000Z',
          duration: 10,
          outputTag1: 'tag1value2',
          outputTag2: 'tag2value2',
          outputMetric1: 0.25,
        },
        {
          'instance-id': 'i-123456',
          timestamp: '2024-06-10T05:00:10.000Z',
          duration: 10,
          outputTag1: 'tag1value2',
          outputTag2: 'tag2value2',
          outputMetric1: 0.14,
        },
      ]);
    });
  });
});
