data {
  int<lower=1> N;
  vector[N] delta;
  array[N] int<lower=1, upper=3> target_index; // 1 = A, 2 = B, 3 = C
  array[N] int<lower=1, upper=3> y; // participant choice: 1 = A, 2 = B, 3 = C
}
parameters {
  real<lower=0> sensitivity;
  real bias_b;
  real bias_c;
}
model {
  sensitivity ~ lognormal(0, 0.5);
  bias_b ~ normal(0, 0.5);
  bias_c ~ normal(0, 0.5);

  for (n in 1 : N) {
    vector[3] evidence;

    evidence[1] = sensitivity * ((target_index[n] == 1 ? delta[n] : 0) / 20);
    evidence[2] = bias_b + sensitivity * ((target_index[n] == 2 ? delta[n] : 0) / 20);
    evidence[3] = bias_c + sensitivity * ((target_index[n] == 3 ? delta[n] : 0) / 20);

    y[n] ~ categorical_logit(evidence);
  }
}
generated quantities {
  vector[N] p_a;
  vector[N] p_b;
  vector[N] p_c;

  for (n in 1 : N) {
    vector[3] evidence;
    vector[3] p;

    evidence[1] = sensitivity * ((target_index[n] == 1 ? delta[n] : 0) / 20);
    evidence[2] = bias_b + sensitivity * ((target_index[n] == 2 ? delta[n] : 0) / 20);
    evidence[3] = bias_c + sensitivity * ((target_index[n] == 3 ? delta[n] : 0) / 20);
    p = softmax(evidence);

    p_a[n] = p[1];
    p_b[n] = p[2];
    p_c[n] = p[3];
  }
}
