use napi::{Env, JsString, JsUndefined, Result, Task};

pub struct QueryTask {
    pub request: String,
}

impl Task for QueryTask {
    type Output = String;
    type JsValue = JsString;

    fn compute(&mut self) -> Result<Self::Output> {
        crate::query::query_logs_json(std::mem::take(&mut self.request))
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
        env.create_string_from_std(output)
    }
}

pub struct CleanupTask {
    pub request: String,
}

impl Task for CleanupTask {
    type Output = ();
    type JsValue = JsUndefined;

    fn compute(&mut self) -> Result<Self::Output> {
        crate::cleanup::cleanup_logs_json(std::mem::take(&mut self.request))
    }

    fn resolve(&mut self, env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        env.get_undefined()
    }
}
