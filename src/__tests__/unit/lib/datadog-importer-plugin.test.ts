import {DatadogImporter} from '../../../lib';
import {v1} from '@datadog/datadog-api-client';
import {ApiException} from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common';

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

  const globalConfig = {
    'id-tag': 'app',
    'location-tag': 'region',
    'instance-type-tag': 'instance-type',
    metrics: 'metric1,metric2',
    'output-metric-names': 'outputMetric1,outputMetric2',
  };

  const validInput = [
    {
      id: 'i-123456',
      timestamp: '2024-06-10T05:00:00.000Z',
      duration: 20,
    },
  ];

  describe('execute(): ', () => {
    it('has metadata field.', () => {
      const pluginInstance = DatadogImporter({});

      expect(pluginInstance).toHaveProperty('metadata');
      expect(pluginInstance).toHaveProperty('execute');
      expect(pluginInstance.metadata).toHaveProperty('kind');
      expect(typeof pluginInstance.execute).toBe('function');
    });

    it('should return the input if output-metric-names contains duplicate values', async () => {
      const invalidConfig = {
        ...globalConfig,
        'output-metric-names': 'outputMetric1,outputMetric1',
      };
      const importer = DatadogImporter(invalidConfig);
      const result = await importer.execute(validInput);
      expect(result).toEqual(validInput);
    });

    it('should return the input if metrics and output-metric-names length are not equal', async () => {
      const invalidConfig = {
        ...globalConfig,
        'output-metric-names': 'outputMetric1',
      };
      const importer = DatadogImporter(invalidConfig);
      const result = await importer.execute(validInput);
      expect(result).toEqual(validInput);
    });

    it('should return the input if a metric does not exist', async () => {
      const createMockApiInstance = () => ({
        getMetricMetadata: jest
          .fn()
          .mockRejectedValue(new ApiException(404, {errors: ['Not Found']})),
      });

      const apiInstance = createMockApiInstance();
      (v1.MetricsApi as jest.Mock).mockImplementation(() => apiInstance);

      const importer = DatadogImporter(globalConfig);
      const result = await importer.execute(validInput);
      expect(result).toEqual(validInput);
    });

    it('should execute and return transformed data', async () => {
      const metricToSeriesDataMap: Map<string, any> = new Map();

      const seriesDataMetric1 = [
        {
          tagSet: [
            'id:i-123456',
            'region:us-central',
            'instance-type:t2.micro',
          ],
          pointlist: [
            [1717995600000, 1],
            [1717995610000, 0.7],
          ],
        },
      ];

      const seriesDataMetric2 = [
        {
          tagSet: [
            'id:i-123456',
            'region:us-central',
            'instance-type:t2.micro',
          ],
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

      const importer = DatadogImporter(globalConfig);
      const result = await importer.execute(validInput);

      expect(result).toEqual([
        {
          id: 'i-123456',
          timestamp: '2024-06-10T05:00:00.000Z',
          duration: 10,
          location: 'us-central',
          'cloud/instance-type': 't2.micro',
          outputMetric1: 1,
          outputMetric2: 0.25,
        },
        {
          id: 'i-123456',
          timestamp: '2024-06-10T05:00:10.000Z',
          duration: 10,
          location: 'us-central',
          'cloud/instance-type': 't2.micro',
          outputMetric1: 0.7,
          outputMetric2: 0.14,
        },
      ]);
    });
  });
});
