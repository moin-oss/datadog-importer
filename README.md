# if-plugin-template

`if-plugin-template` is an environmental impact calculator template which exposes an API for [IF](https://github.com/Green-Software-Foundation/if) to retrieve energy and embodied carbon estimates.

## Implementation

Here can be implementation details of the plugin. For example which API is used, transformations and etc.

## Usage

To run the `<YOUR-CUSTOM-PLUGIN>`, an instance of `PluginInterface` must be created. Then, the plugin's `execute()` method can be called, passing required arguments to it.

This is how you could run the model in Typescript:

```typescript
async function runPlugin() {
  const newModel = await new MyCustomPlugin().configure(params);
  const usage = await newModel.calculate([
    {
      timestamp: '2021-01-01T00:00:00Z',
      duration: '15s',
      'cpu-util': 34,
    },
    {
      timestamp: '2021-01-01T00:00:15Z',
      duration: '15s',
      'cpu-util': 12,
    },
  ]);

  console.log(usage);
}

runPlugin();
```

## Testing model integration

### Using local links

For using locally developed model in `IF Framework` please follow these steps: 

1. On the root level of a locally developed model run `npm link`, which will create global package. It uses `package.json` file's `name` field as a package name. Additionally name can be checked by running `npm ls -g --depth=0 --link=true`.
2. Use the linked model in impl by specifying `name`, `method`, `path` in initialize models section. 

```yaml
name: plugin-demo-link
description: loads plugin
tags: null
initialize:
  plugins:
    my-custom-plugin:
      method: MyCustomPlugin
      path: "<name-field-from-package.json>"
      global-config:
        ...
...
```

### Using directly from Github

You can simply push your model to the public Github repository and pass the path to it in your impl.
For example, for a model saved in `github.com/my-repo/my-model` you can do the following:

npm install your model: 

```
npm install -g https://github.com/my-repo/my-model
```

Then, in your `impl`, provide the path in the model instantiation. You also need to specify which class the model instantiates. In this case you are using the `PluginInterface`, so you can specify `OutputModel`. 

```yaml
name: plugin-demo-git
description: loads plugin
tags: null
initialize:
  plugins:
    my-custom-plugin:
      method: MyCustomPlugin
      path: https://github.com/my-repo/my-model
      global-config:
        ...
...
```

Now, when you run the `manifest` using the IF CLI, it will load the model automatically. Run using:

```sh
ie --manifest <path-to-your-impl> --output <path-to-save-output>
```
