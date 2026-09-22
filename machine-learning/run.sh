PYTHONPATH=/home/orangepi/immich/machine-learning \
MACHINE_LEARNING_RKNN_THREADS=3 \
python -m gunicorn\
   immich_ml.main:app\
    -k immich_ml.config.CustomUvicornWorker\
    -c immich_ml/gunicorn_conf.py\
    --log-config-json immich_ml/log_conf.json\
    -b 0.0.0.0:3003   -w 1